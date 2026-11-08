import { randomBytes, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { FhirResource } from 'fhir/r4';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleFhirRequest } from '@/lib/fhir/gateway';
import { FHIR_RESOURCES_TABLE } from '@/lib/fhir/providers/mock';
import { toRow } from '@/lib/fhir/providers/mock-index';
import { ensureUser, setMemberships } from '@/scripts/lib/users';

/**
 * End to end through the real gateway: real Supabase Auth tokens, real
 * clinic_members rows, real mock data. Everything it creates is throwaway.
 */
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;

describe.skipIf(!url || !key)('gateway authentication (Supabase)', () => {
  const run = randomUUID().slice(0, 8);
  const clinicA = `cf-auth-a-${run}`;
  const clinicB = `cf-auth-b-${run}`;
  const password = randomBytes(18).toString('base64url');
  const serviceToken = randomBytes(32).toString('base64url');
  const users = { a: `cf-auth-a-${run}@test.brevicor.test`, ab: `cf-auth-ab-${run}@test.brevicor.test` };
  const userIds: string[] = [];
  const tokens: Record<keyof typeof users, string> = { a: '', ab: '' };
  let db: SupabaseClient;

  const patient = (id: string): FhirResource => ({ resourceType: 'Patient', id, name: [{ family: 'Test' }] });

  beforeAll(async () => {
    vi.stubEnv('INTERNAL_SERVICE_TOKEN', serviceToken);
    db = createClient(url!, key!, { auth: { persistSession: false } });

    const clinics = await db.from('ehr_connections').insert([
      { clinic_id: clinicA, name: 'Auth test A', mode: 'mock' },
      { clinic_id: clinicB, name: 'Auth test B', mode: 'mock' },
    ]);
    if (clinics.error) throw new Error(clinics.error.message);
    const now = new Date();
    const rows = await db
      .from(FHIR_RESOURCES_TABLE)
      .insert([toRow(clinicA, patient('pat-a'), 1, now), toRow(clinicB, patient('pat-b'), 1, now)]);
    if (rows.error) throw new Error(rows.error.message);

    const a = await ensureUser(db, users.a, password);
    const ab = await ensureUser(db, users.ab, password);
    userIds.push(a, ab);
    await setMemberships(db, a, [{ clinicId: clinicA, role: 'physician', practitionerRef: 'Practitioner/doc-a' }]);
    await setMemberships(db, ab, [
      { clinicId: clinicA, role: 'staff', practitionerRef: null },
      { clinicId: clinicB, role: 'staff', practitionerRef: null },
    ]);

    for (const k of ['a', 'ab'] as const) {
      // A separate client per sign-in, so the shared admin client never takes on a user session.
      const signIn = await createClient(url!, key!, { auth: { persistSession: false } }).auth.signInWithPassword({
        email: users[k],
        password,
      });
      if (!signIn.data.session) throw new Error(`sign-in failed: ${signIn.error?.message}`);
      tokens[k] = signIn.data.session.access_token;
    }
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    for (const id of userIds) await db.auth.admin.deleteUser(id); // memberships cascade
    await db.from('ehr_connections').delete().in('clinic_id', [clinicA, clinicB]); // resources cascade
  });

  async function call(path: string, headers: Record<string, string> = {}) {
    const req = new Request(`https://gw.test/api/fhir/R4/${path}`, { headers });
    const res = await handleFhirRequest(req, path.split('?')[0].split('/'));
    const body = await res.json();
    if (res.status >= 400) expect(body.resourceType).toBe('OperationOutcome');
    return { status: res.status, body, res };
  }
  const bearer = (token: string, clinic?: string) => ({
    Authorization: `Bearer ${token}`,
    ...(clinic ? { 'X-Clinic-Id': clinic } : {}),
  });

  it('no token -> 401', async () => {
    const { status, res } = await call('Patient/pat-a');
    expect(status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer');
  });

  it('X-Clinic-Id alone no longer works -> 401', async () => {
    expect((await call('Patient/pat-a', { 'X-Clinic-Id': clinicA })).status).toBe(401);
  });

  it('bad or tampered token -> 401', async () => {
    expect((await call('Patient/pat-a', bearer('not-a-jwt'))).status).toBe(401);
    const [h, p, s] = tokens.a.split('.');
    const tampered = `${h}.${p}.${s.slice(0, -4)}${s.endsWith('AAAA') ? 'BBBB' : 'AAAA'}`;
    expect((await call('Patient/pat-a', bearer(tampered))).status).toBe(401);
    // A valid signature over a payload claiming to be someone else: still rejected.
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), sub: userIds[1] })).toString('base64url');
    expect((await call('Patient/pat-a', bearer(`${h}.${forged}.${s}`))).status).toBe(401);
  });

  it('own clinic -> 200', async () => {
    const { status, body } = await call('Patient/pat-a', bearer(tokens.a));
    expect(status).toBe(200);
    expect(body.id).toBe('pat-a');
    expect((await call('Patient?_id=pat-a', bearer(tokens.a))).body.total).toBe(1);
  });

  it('X-Clinic-Id that is not one of theirs -> 403', async () => {
    expect((await call('Patient/pat-b', bearer(tokens.a, clinicB))).status).toBe(403);
  });

  it("another clinic's resource -> 404", async () => {
    expect((await call('Patient/pat-b', bearer(tokens.a))).status).toBe(404);
    expect((await call('Patient/pat-a', bearer(tokens.ab, clinicB))).status).toBe(404);
  });

  it('multi-clinic user: X-Clinic-Id required, then scoped to that clinic', async () => {
    expect((await call('Patient/pat-b', bearer(tokens.ab))).status).toBe(400);
    expect((await call('Patient/pat-b', bearer(tokens.ab, clinicB))).status).toBe(200);
    expect((await call('Patient/pat-a', bearer(tokens.ab, clinicA))).status).toBe(200);
  });

  it('service token with X-Clinic-Id works', async () => {
    const { status, body } = await call('Patient/pat-b', bearer(serviceToken, clinicB));
    expect(status).toBe(200);
    expect(body.id).toBe('pat-b');
  });

  it('service token without X-Clinic-Id -> 400; unknown clinic -> 404', async () => {
    expect((await call('Patient/pat-a', bearer(serviceToken))).status).toBe(400);
    expect((await call('Patient/pat-a', bearer(serviceToken, 'cf-no-such-clinic'))).status).toBe(404);
  });

  it('metadata needs authentication too', async () => {
    expect((await call('metadata')).status).toBe(401);
    expect((await call('metadata', bearer(tokens.a))).body.resourceType).toBe('CapabilityStatement');
  });
});
