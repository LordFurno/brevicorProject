import type { Bundle, BundleEntry, FhirResource } from 'fhir/r4';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dispatch } from '@/lib/fhir/dispatch';
import { supports, type Capabilities, type EhrProvider, type InScopeType } from '@/lib/fhir/provider';
import { validateResource } from '@/lib/fhir/validate';
import { FIXTURES, REQUIRED_SEARCH_PARAMS, SEARCH_CASES } from './fixtures';

/**
 * The provider contract: one suite every EHR integration (mock, native FHIR,
 * phase-2 adapters) must pass, exercised through the real gateway dispatch so
 * it checks what the app actually sees.
 */
export interface ContractHarness {
  name: string;
  /** Load FIXTURES into the backend and return a provider over it. */
  setup(): Promise<{
    provider: EhrProvider;
    /** `created` lists "Type/id" of resources the write tests made. */
    teardown(created: string[]): Promise<void>;
  }>;
}

const BASE = 'https://gateway.test/api/fhir/R4';

interface Call {
  res: Response;
  body: any; // parsed JSON under test
}

export function runProviderContract(harness: ContractHarness): void {
  describe(`provider contract: ${harness.name}`, () => {
    let provider: EhrProvider;
    let teardown: (created: string[]) => Promise<void> = async () => {};
    let caps: Capabilities;
    const created: string[] = [];

    beforeAll(async () => {
      ({ provider, teardown } = await harness.setup());
      caps = await provider.capabilities();
    });

    afterAll(async () => {
      await teardown(created);
    });

    async function call(method: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Call> {
      const url = path.startsWith('http') ? path : `${BASE}/${path}`;
      const req = new Request(url, {
        method,
        headers: init.body === undefined ? init.headers : { 'Content-Type': 'application/fhir+json', ...init.headers },
        body: init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
      });
      const segments = new URL(url).pathname.slice(new URL(BASE).pathname.length + 1).split('/');
      const res = await dispatch(req, segments, async () => ({ provider, clinicId: 'contract' }), { baseUrl: BASE });
      expect(res.headers.get('Content-Type'), `${method} ${path}`).toMatch(/^application\/fhir\+json/);
      const body = await res.json();
      assertValidFhir(body);
      return { res, body };
    }

    function matchIds(bundle: Bundle): string[] {
      return (bundle.entry ?? [])
        .filter((e: BundleEntry) => e.search?.mode === 'match')
        .map((e: BundleEntry) => e.resource!.id!)
        .sort();
    }

    function expectOutcome({ res, body }: Call, status: number, code?: string): void {
      expect(res.status).toBe(status);
      expect(body.resourceType).toBe('OperationOutcome');
      expect(body.issue.length).toBeGreaterThan(0);
      if (code) expect(body.issue[0].code).toBe(code);
    }

    describe('capabilities', () => {
      it('serves a CapabilityStatement that covers the required contract', async () => {
        const { res, body } = await call('GET', 'metadata');
        expect(res.status).toBe(200);
        expect(body).toMatchObject({ resourceType: 'CapabilityStatement', fhirVersion: '4.0.1', kind: 'instance' });
        for (const [type, params] of Object.entries(REQUIRED_SEARCH_PARAMS)) {
          const r = body.rest[0].resource.find((x: { type: string }) => x.type === type);
          expect(r, type).toBeDefined();
          const interactions = r.interaction.map((i: { code: string }) => i.code);
          expect(interactions, type).toEqual(expect.arrayContaining(['read', 'search-type']));
          const declared = r.searchParam.map((p: { name: string }) => p.name);
          expect(declared, type).toEqual(expect.arrayContaining(params));
        }
      });
    });

    describe('read', () => {
      it.each(FIXTURES.map((r) => [`${r.resourceType}/${r.id}`, r] as const))('%s', async (ref, fixture) => {
        const { res, body } = await call('GET', ref);
        expect(res.status).toBe(200);
        const { meta: _meta, ...expected } = fixture as FhirResource & { meta?: unknown };
        expect(body).toMatchObject(expected);
        expect(body.meta?.versionId).toBeTruthy();
        expect(res.headers.get('ETag')).toMatch(/^W\/"/);
      });

      it('missing resource -> 404 OperationOutcome', async () => {
        expectOutcome(await call('GET', 'Patient/cf-does-not-exist'), 404, 'not-found');
      });
    });

    describe('search', () => {
      it.each(SEARCH_CASES)('%s', async (query, expected) => {
        const { res, body } = await call('GET', query);
        expect(res.status).toBe(200);
        expect(body).toMatchObject({ resourceType: 'Bundle', type: 'searchset' });
        expect(matchIds(body)).toEqual([...expected].sort());
        for (const e of body.entry) {
          if (e.search.mode === 'match') expect(e.fullUrl).toBe(`${BASE}/${e.resource.resourceType}/${e.resource.id}`);
        }
        expect(body.link[0]).toEqual({ relation: 'self', url: `${BASE}/${query}` });
      });

      it('covers every required search param', () => {
        const covered = new Set(
          SEARCH_CASES.flatMap(([q]) => {
            const [type, qs] = q.split('?');
            return [...new URLSearchParams(qs).keys()].map((k) => `${type}.${k}`);
          }),
        );
        for (const [type, params] of Object.entries(REQUIRED_SEARCH_PARAMS)) {
          for (const p of params) expect(covered, `${type}.${p}`).toContain(`${type}.${p}`);
        }
      });

      it('pages with _count and the next link', async () => {
        const first = await call('GET', 'Patient?family=tremblay,nguyen&_count=1');
        expect(matchIds(first.body)).toHaveLength(1);
        const next = first.body.link.find((l: { relation: string }) => l.relation === 'next');
        expect(next?.url).toMatch(/_offset=1/);
        const second = await call('GET', next.url);
        expect(second.res.status).toBe(200);
        expect([...matchIds(first.body), ...matchIds(second.body)].sort()).toEqual(['cf-pat-1', 'cf-pat-2']);
      });

      it('_count=0 returns no entries', async () => {
        const { res, body } = await call('GET', 'Patient?family=tremblay,nguyen&_count=0');
        expect(res.status).toBe(200);
        expect(matchIds(body)).toEqual([]);
      });

      it('unknown search param -> 400 OperationOutcome', async () => {
        expectOutcome(await call('GET', 'Patient?not-a-param=1'), 400);
      });

      it('invalid date -> 400 OperationOutcome', async () => {
        expectOutcome(await call('GET', 'Appointment?date=ge2030-99-99'), 400);
      });
    });

    describe('unsupported operations', () => {
      it('DELETE -> 501 OperationOutcome', async () => {
        expectOutcome(await call('DELETE', 'Patient/cf-pat-1'), 501, 'not-supported');
      });

      it('interactions missing from capabilities -> 501 OperationOutcome', async () => {
        const types = Object.keys(REQUIRED_SEARCH_PARAMS) as InScopeType[];
        for (const type of types) {
          if (!supports(caps, type, 'create')) {
            expectOutcome(await call('POST', type, { body: FIXTURES.find((r) => r.resourceType === type) }), 501, 'not-supported');
          }
          if (!supports(caps, type, 'update')) {
            const fixture = FIXTURES.find((r) => r.resourceType === type)!;
            expectOutcome(await call('PUT', `${type}/${fixture.id}`, { body: fixture }), 501, 'not-supported');
          }
        }
      });
    });

    describe('writes (where supported)', () => {
      const encounter = {
        resourceType: 'Encounter',
        status: 'planned',
        class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'VR' },
        subject: { reference: 'Patient/cf-pat-w' },
      };

      it('rejects invalid resources with 400 before reaching the EHR', async () => {
        if (!supports(caps, 'Encounter', 'create')) return; // read-only EHRs answer 501 (checked above)
        expectOutcome(await call('POST', 'Encounter', { body: { resourceType: 'Encounter', class: {} } }), 400);
        expectOutcome(await call('POST', 'Encounter', { body: { resourceType: 'Patient' } }), 400);
        expectOutcome(await call('POST', 'Encounter', { body: '{oops' }), 400);
      });

      it('Encounter create -> read -> update bumps versionId; stale If-Match -> 412', async () => {
        if (!supports(caps, 'Encounter', 'create')) return;
        const made = await call('POST', 'Encounter', { body: encounter });
        expect(made.res.status).toBe(201);
        const id = made.body.id as string;
        created.push(`Encounter/${id}`);
        expect(made.body.meta.versionId).toBe('1');
        expect(made.res.headers.get('Location')).toBe(`${BASE}/Encounter/${id}/_history/1`);

        const read = await call('GET', `Encounter/${id}`);
        expect(read.body).toMatchObject({ ...encounter, id });

        if (!supports(caps, 'Encounter', 'update')) return;
        const updated = await call('PUT', `Encounter/${id}`, {
          body: { ...encounter, id, status: 'in-progress' },
          headers: { 'If-Match': 'W/"1"' },
        });
        expect(updated.res.status).toBe(200);
        expect(updated.body).toMatchObject({ id, status: 'in-progress', meta: { versionId: '2' } });

        expectOutcome(
          await call('PUT', `Encounter/${id}`, { body: { ...encounter, id, status: 'finished' }, headers: { 'If-Match': 'W/"1"' } }),
          412,
        );
      });

      it('DocumentReference create', async () => {
        if (!supports(caps, 'DocumentReference', 'create')) return;
        const made = await call('POST', 'DocumentReference', {
          body: {
            resourceType: 'DocumentReference',
            status: 'current',
            subject: { reference: 'Patient/cf-pat-w' },
            content: [{ attachment: { contentType: 'text/plain', data: 'dW52ZXJpZmllZA==' } }],
          },
        });
        expect(made.res.status).toBe(201);
        created.push(`DocumentReference/${made.body.id}`);
        expect(made.body.meta.versionId).toBe('1');
      });

      it('conditional create: no match -> 201, same criteria again -> 200 with that resource', async () => {
        if (!supports(caps, 'Encounter', 'create')) return;
        const body = { ...encounter, appointment: [{ reference: 'Appointment/cf-appt-3' }] };
        const headers = { 'If-None-Exist': 'appointment=Appointment/cf-appt-3' };
        const first = await call('POST', 'Encounter', { body, headers });
        // A persistent server (HAPI) may still hold one from an earlier run: then it is a 200 too.
        expect([200, 201]).toContain(first.res.status);
        if (first.res.status === 201) created.push(`Encounter/${first.body.id}`);
        const second = await call('POST', 'Encounter', { body, headers });
        expect(second.res.status).toBe(200);
        expect(second.body.id).toBe(first.body.id);
      });

      it('conditional create returns the existing EHR resource instead of creating one', async () => {
        if (!supports(caps, 'Encounter', 'create')) return;
        const res = await call('POST', 'Encounter', {
          body: { ...encounter, subject: { reference: 'Patient/cf-pat-1' }, appointment: [{ reference: 'Appointment/cf-appt-1' }] },
          headers: { 'If-None-Exist': 'appointment=Appointment/cf-appt-1' },
        });
        expect(res.res.status).toBe(200);
        expect(res.body.id).toBe('cf-enc-1');
      });

      it('conditional create with an unsupported criterion -> 400', async () => {
        if (!supports(caps, 'Encounter', 'create')) return;
        expectOutcome(await call('POST', 'Encounter', { body: encounter, headers: { 'If-None-Exist': 'not-a-param=1' } }), 400);
      });

      it('a write the EHR cannot take is stored by Brevicor (local-only), never dropped, and found by search', async () => {
        const rc = caps.resources.find((r) => r.type === 'DocumentReference');
        if (!rc?.fallback?.includes('create')) return; // the EHR stores it itself
        const meta = await call('GET', 'metadata');
        const create = meta.body.rest[0].resource
          .find((r: { type: string }) => r.type === 'DocumentReference')
          .interaction.find((i: { code: string }) => i.code === 'create');
        expect(create.extension?.[0]).toEqual({ url: 'https://brevicor.ca/fhir/StructureDefinition/capability-fallback', valueCode: 'local-only' });

        const made = await call('POST', 'DocumentReference', {
          body: {
            resourceType: 'DocumentReference',
            status: 'current',
            subject: { reference: 'Patient/cf-pat-1' },
            context: { encounter: [{ reference: 'Encounter/cf-enc-1' }] },
            content: [{ attachment: { contentType: 'image/jpeg', url: 'https://app.example/photo/1' } }],
          },
        });
        expect(made.res.status).toBe(201);
        created.push(`DocumentReference/${made.body.id}`);
        expect(made.body.meta.tag).toContainEqual(expect.objectContaining({ system: 'https://brevicor.ca/fhir/sync-status', code: 'local-only' }));
        expect((await call('GET', `DocumentReference/${made.body.id}`)).res.status).toBe(200);
        // Merged with the EHR's own documents for the same encounter.
        expect(matchIds((await call('GET', 'DocumentReference?encounter=cf-enc-1')).body).sort()).toEqual(['cf-doc-1', made.body.id].sort());
      });

      it('update of a missing resource -> 404 (or update-as-create where the EHR allows it)', async () => {
        if (!supports(caps, 'Encounter', 'update')) return;
        // Native servers may allow update-as-create; only the mock forbids it.
        const res = await call('PUT', 'Encounter/cf-missing-enc', { body: { ...encounter, id: 'cf-missing-enc' } });
        if (res.res.status === 404) expectOutcome(res, 404);
        else created.push('Encounter/cf-missing-enc');
      });
    });
  });
}

/** Every resource that leaves the gateway must be structurally valid R4. */
function assertValidFhir(body: unknown): void {
  const resource = body as FhirResource;
  expect(validateResource(resource), `${resource.resourceType}/${resource.id}`).toEqual([]);
  if (resource.resourceType === 'Bundle') {
    for (const entry of resource.entry ?? []) {
      expect(validateResource(entry.resource), `${entry.resource?.resourceType}/${entry.resource?.id}`).toEqual([]);
    }
  }
}
