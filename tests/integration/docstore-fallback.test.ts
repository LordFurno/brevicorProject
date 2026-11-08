import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Bundle, Encounter } from 'fhir/r4';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dispatch } from '@/lib/fhir/dispatch';
import type { EhrConnection, EhrProvider } from '@/lib/fhir/provider';
import { createProvider, DOCSTORE_INTERACTIONS } from '@/lib/fhir/providers';
import { AdapterProvider } from '@/lib/fhir/providers/adapter';
import { FallbackProvider } from '@/lib/fhir/providers/fallback';
import { FHIR_DOCSTORE_TABLE, MockProvider } from '@/lib/fhir/providers/mock';
import { handleClinicSoftRequest } from '@/lib/vendors/clinicsoft/api';
import { CLINICSOFT_SCHEMA } from '@/lib/vendors/clinicsoft/rows';

/**
 * No write is lost at a read-only EHR. A throwaway clinic reads the real
 * ClinicSoft demo practice (read-only adapter) and writes through the real
 * gateway dispatch into the real Brevicor docstore (fhir_docstore). Needs
 * `npm run fhir:reset -- demo-mock` (loads ClinicSoft 'demo').
 */
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const BASE = 'https://gateway.test/api/fhir/R4';

describe.skipIf(!url || !key)('docstore fallback at a read-only EHR (ClinicSoft)', () => {
  let db: SupabaseClient;
  let provider: EhrProvider;
  let conn: EhrConnection;
  let vendorFetch: typeof fetch;
  const clinicId = `cf-${randomUUID().slice(0, 8)}-fallback`;
  let patientId: string;
  let appointmentId: string;
  let ehrEncounters: number;

  async function call(p: EhrProvider, method: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) {
    const full = path.startsWith('http') ? path : `${BASE}/${path}`;
    const req = new Request(full, {
      method,
      headers: init.body !== undefined ? { 'Content-Type': 'application/fhir+json', ...init.headers } : init.headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const res = await dispatch(req, new URL(full).pathname.replace('/api/fhir/R4/', '').split('/'), async () => ({ provider: p, clinicId }), { baseUrl: BASE });
    return { res, body: await res.json() };
  }

  beforeAll(async () => {
    db = createClient(url!, key!, { auth: { persistSession: false } });
    const apiKey = 'fallback-test-key';
    vi.stubEnv('CLINICSOFT_FALLBACK_KEY', apiKey);
    vendorFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(input));
      return handleClinicSoftRequest(new Request(u, init), u.pathname.replace(/^\/api\/mock-vendors\/clinicsoft\/v2\//, '').split('/'), { db, apiKey });
    }) as typeof fetch;
    const { data: real, error } = await db.from('ehr_connections').select('adapter_config').eq('clinic_id', 'demo-clinicsoft').single();
    if (error) throw new Error(`demo-clinicsoft connection missing: ${error.message}`);
    const created = await db.from('ehr_connections').insert({ clinic_id: clinicId, name: 'Fallback test', mode: 'adapter' });
    if (created.error) throw new Error(`creating test clinic failed: ${created.error.message}`);
    conn = {
      clinicId,
      name: 'Fallback test',
      mode: 'adapter',
      baseUrl: null,
      auth: { type: 'apiKey', keyEnv: 'CLINICSOFT_FALLBACK_KEY' },
      adapterConfig: { ...(real.adapter_config as object), baseUrl: 'http://vendor.test/api/mock-vendors/clinicsoft/v2/practices/demo' },
      readOnly: true,
    };
    provider = createProvider(conn, { supabase: db, fetch: vendorFetch });

    // A real demo appointment, and how many encounters ClinicSoft itself has for that patient.
    const { data: appt } = await db.schema(CLINICSOFT_SCHEMA).from('schedule').select('apptId,patientNo').eq('practice_id', 'demo').limit(1).single();
    if (!appt) throw new Error('no ClinicSoft demo appointments: run `npm run fhir:reset -- demo-mock` first');
    appointmentId = appt.apptId;
    patientId = appt.patientNo;
    const { count } = await db.schema(CLINICSOFT_SCHEMA).from('encounters').select('encounterNo', { count: 'exact', head: true }).eq('practice_id', 'demo').eq('patientNo', patientId);
    ehrEncounters = count ?? 0;
    expect(ehrEncounters).toBeGreaterThan(0);
  });

  afterAll(async () => {
    await db.from('ehr_connections').delete().eq('clinic_id', clinicId); // docstore rows cascade
    vi.unstubAllEnvs();
  });

  it('CapabilityStatement: ClinicSoft is read-only, Encounter/DocumentReference create is supported with fallback', async () => {
    const { body } = await call(provider, 'GET', 'metadata');
    const resource = (type: string) => body.rest[0].resource.find((r: { type: string }) => r.type === type);
    for (const type of ['Encounter', 'DocumentReference']) {
      const create = resource(type).interaction.find((i: { code: string }) => i.code === 'create');
      expect(create, type).toMatchObject({ extension: [{ valueCode: 'local-only' }] });
    }
    expect(resource('Condition').interaction.map((i: { code: string }) => i.code)).toEqual(['read', 'search-type']);
  });

  let encounterId: string;

  it('admitting: conditional create stores the Encounter locally once, and finds it again', async () => {
    const body: Encounter = {
      resourceType: 'Encounter',
      identifier: [{ system: 'https://brevicor.ca/fhir/sid/appointment-encounter', value: appointmentId }],
      status: 'in-progress',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'VR' },
      subject: { reference: `Patient/${patientId}` },
      appointment: [{ reference: `Appointment/${appointmentId}` }],
      period: { start: new Date().toISOString().replace(/\.\d+Z$/, 'Z') },
    };
    const headers = { 'If-None-Exist': `appointment=Appointment/${appointmentId}` };
    const first = await call(provider, 'POST', 'Encounter', { body, headers });
    expect(first.res.status).toBe(201);
    expect(first.body.meta.tag).toContainEqual(expect.objectContaining({ code: 'local-only' }));
    encounterId = first.body.id;
    const again = await call(provider, 'POST', 'Encounter', { body, headers });
    expect(again.res.status).toBe(200);
    expect(again.body.id).toBe(encounterId);

    const { count } = await db.from(FHIR_DOCSTORE_TABLE).select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId).eq('resource_type', 'Encounter');
    expect(count).toBe(1);
    // Nothing went into ClinicSoft (it can't take writes) or into the mock EHR table.
    const inEhr = await db.from('fhir_resources').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId);
    expect(inEhr.count).toBe(0);
  });

  it('reads and searches merge EHR and local resources, with exact paging at _count=1', async () => {
    expect((await call(provider, 'GET', `Encounter/${encounterId}`)).body.status).toBe('in-progress');
    expect((await call(provider, 'GET', `Encounter?appointment=Appointment/${appointmentId}`)).body.entry.map((e: { resource: { id: string } }) => e.resource.id)).toEqual([encounterId]);

    const ids: string[] = [];
    let next: string | undefined = `Encounter?patient=Patient/${patientId}&_count=1`;
    let total: number | undefined;
    while (next) {
      const page: { body: Bundle } = await call(provider, 'GET', next);
      total = page.body.total;
      ids.push(...(page.body.entry ?? []).map((e) => e.resource!.id!));
      next = page.body.link?.find((l) => l.relation === 'next')?.url;
    }
    expect(total).toBe(ehrEncounters + 1);
    expect(ids).toHaveLength(ehrEncounters + 1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.at(-1)).toBe(encounterId); // local results come after the EHR's
  });

  it('"Save to chart": a DocumentReference for that encounter is stored locally and found by encounter and patient', async () => {
    const made = await call(provider, 'POST', 'DocumentReference', {
      body: {
        resourceType: 'DocumentReference',
        status: 'current',
        docStatus: 'final',
        subject: { reference: `Patient/${patientId}` },
        date: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
        description: 'Synthetic test photo',
        content: [{ attachment: { contentType: 'image/jpeg', url: 'https://app.example/api/media/photos/test', title: 'Clinical photo' } }],
        context: { encounter: [{ reference: `Encounter/${encounterId}` }] },
      },
    });
    expect(made.res.status).toBe(201);
    expect(made.body.meta.tag).toContainEqual(expect.objectContaining({ code: 'local-only' }));
    const byEncounter = await call(provider, 'GET', `DocumentReference?encounter=Encounter/${encounterId}`);
    expect(byEncounter.body.entry.map((e: { resource: { id: string } }) => e.resource.id)).toEqual([made.body.id]);
    const byPatient = await call(provider, 'GET', `DocumentReference?patient=${patientId}&_count=100`);
    expect(byPatient.body.entry.map((e: { resource: { id: string } }) => e.resource.id)).toContain(made.body.id);
  });

  it('when the docstore itself fails, the write is an error (5xx), never a 201', async () => {
    const broken = new FallbackProvider(
      new AdapterProvider(conn, { fetch: vendorFetch }),
      new MockProvider(db, clinicId, undefined, { table: 'fhir_docstore_does_not_exist', interactions: DOCSTORE_INTERACTIONS }),
    );
    const res = await call(broken, 'POST', 'Encounter', {
      body: { resourceType: 'Encounter', status: 'in-progress', class: { code: 'VR' }, subject: { reference: `Patient/${patientId}` } },
    });
    expect(res.res.status).toBeGreaterThanOrEqual(500);
    expect(res.body.resourceType).toBe('OperationOutcome');
  });
});
