import { describe, expect, it } from 'vitest';
import { resolveCaller, tokensEqual, type AuthDeps, type Membership } from '@/lib/fhir/auth';
import { FhirError } from '@/lib/fhir/outcome';

const SERVICE = 's'.repeat(40);

const MEMBERSHIPS: Record<string, Membership[]> = {
  'user-one': [{ clinicId: 'clinic-a', role: 'physician', practitionerRef: 'Practitioner/p1' }],
  'user-two': [
    { clinicId: 'clinic-a', role: 'physician', practitionerRef: 'Practitioner/p2' },
    { clinicId: 'clinic-b', role: 'staff', practitionerRef: null },
  ],
  'user-none': [],
};

const deps = (overrides: Partial<AuthDeps> = {}): AuthDeps => ({
  serviceToken: SERVICE,
  verifyToken: async (token) => (token.startsWith('jwt-') ? token.slice(4) : null),
  loadMemberships: async (userId) => MEMBERSHIPS[userId] ?? [],
  ...overrides,
});

function req(headers: Record<string, string>): Request {
  return new Request('https://gw.test/api/fhir/R4/Patient', { headers });
}

async function failure(headers: Record<string, string>, d = deps()): Promise<FhirError> {
  const err = await resolveCaller(req(headers), d).then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof FhirError)) throw new Error(`expected FhirError, got ${String(err)}`);
  return err;
}

describe('resolveCaller', () => {
  it.each<[string, Record<string, string>]>([
    ['no Authorization', {}],
    ['X-Clinic-Id alone', { 'X-Clinic-Id': 'clinic-a' }],
    ['not a Bearer scheme', { Authorization: 'Basic abc' }],
    ['empty Bearer', { Authorization: 'Bearer ' }],
    ['invalid token', { Authorization: 'Bearer garbage' }],
  ])('%s -> 401 with WWW-Authenticate', async (_label, headers) => {
    const err = await failure(headers);
    expect([err.status, err.code]).toEqual([401, 'login']);
    expect(err.headers).toEqual({ 'WWW-Authenticate': 'Bearer' });
  });

  it('single-clinic user gets that clinic, role and practitioner', async () => {
    expect(await resolveCaller(req({ Authorization: 'Bearer jwt-user-one' }), deps())).toEqual({
      kind: 'user',
      userId: 'user-one',
      clinicId: 'clinic-a',
      practitionerRef: 'Practitioner/p1',
      role: 'physician',
    });
    const same = await resolveCaller(req({ Authorization: 'Bearer jwt-user-one', 'X-Clinic-Id': 'clinic-a' }), deps());
    expect(same.clinicId).toBe('clinic-a');
  });

  it('single-clinic user asking for another clinic -> 403', async () => {
    const err = await failure({ Authorization: 'Bearer jwt-user-one', 'X-Clinic-Id': 'clinic-b' });
    expect([err.status, err.code]).toEqual([403, 'forbidden']);
  });

  it('multi-clinic user must pick a clinic they belong to', async () => {
    expect((await failure({ Authorization: 'Bearer jwt-user-two' })).status).toBe(400);
    const b = await resolveCaller(req({ Authorization: 'Bearer jwt-user-two', 'X-Clinic-Id': 'clinic-b' }), deps());
    expect(b).toMatchObject({ kind: 'user', clinicId: 'clinic-b', role: 'staff', practitionerRef: null });
    expect((await failure({ Authorization: 'Bearer jwt-user-two', 'X-Clinic-Id': 'clinic-c' })).status).toBe(403);
  });

  it('a user with no memberships -> 403', async () => {
    expect((await failure({ Authorization: 'Bearer jwt-user-none' })).status).toBe(403);
  });

  it('service token needs X-Clinic-Id', async () => {
    expect(await resolveCaller(req({ Authorization: `Bearer ${SERVICE}`, 'X-Clinic-Id': 'clinic-b' }), deps())).toEqual({
      kind: 'service',
      clinicId: 'clinic-b',
    });
    const err = await failure({ Authorization: `Bearer ${SERVICE}` });
    expect([err.status, err.code]).toEqual([400, 'required']);
  });

  it('service auth is off when the token is unset or too short', async () => {
    const short = 'x'.repeat(31);
    for (const serviceToken of [undefined, '', short]) {
      const err = await failure({ Authorization: `Bearer ${short}`, 'X-Clinic-Id': 'clinic-a' }, deps({ serviceToken }));
      expect(err.status).toBe(401);
    }
  });

  it('a near-miss service token is treated as an (invalid) user token', async () => {
    const err = await failure({ Authorization: `Bearer ${SERVICE.slice(0, -1)}x`, 'X-Clinic-Id': 'clinic-a' });
    expect(err.status).toBe(401);
  });

  it('identifies the caller before clinic checks, so a 403 is still attributed', async () => {
    const seen: unknown[] = [];
    await resolveCaller(req({ Authorization: 'Bearer jwt-user-one', 'X-Clinic-Id': 'clinic-b' }), deps(), (c) => seen.push(c)).catch(
      () => {},
    );
    await resolveCaller(req({ Authorization: `Bearer ${SERVICE}` }), deps(), (c) => seen.push(c)).catch(() => {});
    await resolveCaller(req({ Authorization: 'Bearer garbage' }), deps(), (c) => seen.push(c)).catch(() => {});
    expect(seen).toEqual([{ kind: 'user', userId: 'user-one' }, { kind: 'service' }]);
  });

  it('accepts a lowercase scheme', async () => {
    expect((await resolveCaller(req({ Authorization: 'bearer jwt-user-one' }), deps())).kind).toBe('user');
  });
});

describe('tokensEqual', () => {
  it('compares any lengths without throwing', () => {
    expect(tokensEqual('abc', 'abc')).toBe(true);
    expect(tokensEqual('abc', 'abd')).toBe(false);
    expect(tokensEqual('abc', 'abcdef')).toBe(false);
    expect(tokensEqual('', 'x')).toBe(false);
  });
});
