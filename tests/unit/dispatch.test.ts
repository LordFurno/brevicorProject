import type { Bundle, FhirResource } from 'fhir/r4';
import { describe, expect, it, vi } from 'vitest';
import { capabilityStatement } from '@/lib/fhir/capability-statement';
import { dispatch } from '@/lib/fhir/dispatch';
import { FhirError } from '@/lib/fhir/outcome';
import type { Capabilities, EhrProvider } from '@/lib/fhir/provider';

const BASE = 'https://gw.example/api/fhir/R4';

const caps: Capabilities = {
  resources: [
    { type: 'Patient', interactions: ['read', 'search-type'], searchParams: [{ name: 'family', type: 'string' }] },
    { type: 'Encounter', interactions: ['read', 'create', 'update'], searchParams: [] },
  ],
};

const patient: FhirResource = { resourceType: 'Patient', id: 'p1', meta: { versionId: '2', lastUpdated: '2026-11-07T12:00:00Z' } };

function stubProvider(overrides: Partial<EhrProvider> = {}): EhrProvider {
  return {
    capabilities: async () => caps,
    read: async () => patient,
    search: async (): Promise<Bundle> => ({ resourceType: 'Bundle', type: 'searchset', total: 1, entry: [{ resource: patient }] }),
    create: async (_t, r) => ({ ...r, id: 'new-1', meta: { versionId: '1', lastUpdated: '2026-11-07T12:00:00Z' } }),
    update: async (_t, id, r) => ({ ...r, id, meta: { versionId: '3', lastUpdated: '2026-11-07T12:00:00Z' } }),
    ...overrides,
  };
}

async function call(method: string, path: string, init: { body?: unknown; headers?: Record<string, string>; provider?: EhrProvider } = {}) {
  const url = `${BASE}/${path}`;
  const req = new Request(url, {
    method,
    headers: init.body !== undefined ? { 'Content-Type': 'application/fhir+json', ...init.headers } : init.headers,
    body: init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
  });
  const segments = new URL(url).pathname.replace('/api/fhir/R4/', '').split('/');
  const provider = init.provider ?? stubProvider();
  const res = await dispatch(req, segments, async () => provider, { baseUrl: BASE, clinicId: 'test' });
  expect(res.headers.get('Content-Type')).toMatch(/^application\/fhir\+json/);
  return { res, body: await res.json() };
}

describe('dispatch', () => {
  it('serves the CapabilityStatement from provider capabilities', async () => {
    const { res, body } = await call('GET', 'metadata');
    expect(res.status).toBe(200);
    expect(body.rest[0].resource.map((r: { type: string }) => r.type)).toEqual(['Patient', 'Encounter']);
    expect(body).toMatchObject({ resourceType: 'CapabilityStatement', fhirVersion: '4.0.1', kind: 'instance' });
  });

  it('reads with version headers', async () => {
    const { res, body } = await call('GET', 'Patient/p1');
    expect([res.status, body.id]).toEqual([200, 'p1']);
    expect(res.headers.get('ETag')).toBe('W/"2"');
    expect(res.headers.get('Last-Modified')).toBe('Sat, 07 Nov 2026 12:00:00 GMT');
  });

  it('turns provider errors into OperationOutcomes', async () => {
    const provider = stubProvider({
      read: async () => {
        throw new FhirError(404, 'not-found', 'Patient/x is not known');
      },
    });
    const { res, body } = await call('GET', 'Patient/x', { provider });
    expect(res.status).toBe(404);
    expect(body).toEqual({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-found', diagnostics: 'Patient/x is not known' }] });
  });

  it('hides unexpected errors behind a generic 500', async () => {
    const provider = stubProvider({
      read: async () => {
        throw new Error('db password is hunter2');
      },
    });
    const { res, body } = await call('GET', 'Patient/p1', { provider });
    expect(res.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });

  it('reports tenant resolution failures', async () => {
    const req = new Request(`${BASE}/Patient/p1`);
    const res = await dispatch(req, ['Patient', 'p1'], async () => {
      throw new FhirError(401, 'login', 'Missing clinic credentials');
    }, { baseUrl: BASE, clinicId: null });
    expect(res.status).toBe(401);
    expect((await res.json()).issue[0].code).toBe('login');
  });

  it.each([
    ['DELETE', 'Patient/p1', 501],
    ['PATCH', 'Patient/p1', 501],
    ['GET', 'Patient/p1/_history/1', 501],
    ['GET', 'Patient/$everything', 501],
    ['POST', 'Patient', 501], // Patient create not in caps
    ['PUT', 'Patient/p1', 501],
    ['GET', 'Observation/o1', 501], // type not in caps
    ['GET', 'Encounter', 501], // Encounter search not in caps
    ['GET', 'patient/p1', 404],
    ['GET', 'Patient/bad%20id', 400],
  ])('%s %s -> %i', async (method, path, status) => {
    const { res, body } = await call(method, path, method === 'PUT' ? { body: { resourceType: 'Patient', id: 'p1' } } : {});
    expect(res.status).toBe(status);
    expect(body.resourceType).toBe('OperationOutcome');
  });

  it('rejects unsupported search params before calling the provider', async () => {
    const search = vi.fn();
    const { res, body } = await call('GET', 'Patient?family=smith&foo=1', { provider: stubProvider({ search }) });
    expect(res.status).toBe(400);
    expect(body.issue[0].diagnostics).toContain("'foo'");
    expect(search).not.toHaveBeenCalled();
  });

  it('builds a gateway searchset, excluding invalid entries visibly', async () => {
    const provider = stubProvider({
      search: async () => ({
        resourceType: 'Bundle',
        type: 'searchset',
        total: 45,
        link: [{ relation: 'next', url: 'https://upstream.example/fhir?page=2' }],
        entry: [
          { fullUrl: 'https://upstream.example/fhir/Patient/p1', resource: patient },
          { resource: { resourceType: 'Patient', id: 'p2', gender: 'banana' } as unknown as FhirResource },
          { resource: { resourceType: 'Organization', id: 'o1', name: 'included' }, search: { mode: 'include' } },
        ],
      }),
    });
    const { res, body } = await call('GET', 'Patient?family=smith&_count=2', { provider });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ resourceType: 'Bundle', type: 'searchset', total: 45 });
    expect(body.link).toEqual([
      { relation: 'self', url: `${BASE}/Patient?family=smith&_count=2` },
      { relation: 'next', url: `${BASE}/Patient?family=smith&_count=2&_offset=2` },
    ]);
    expect(body.entry[0]).toEqual({ fullUrl: `${BASE}/Patient/p1`, resource: patient, search: { mode: 'match' } });
    expect(body.entry[1].search.mode).toBe('outcome');
    expect(body.entry[1].resource.issue[0].diagnostics).toContain('Patient/p2');
    expect(body.entry).toHaveLength(2);
  });

  it('creates: validates, ignores client ids, returns 201 + Location', async () => {
    const create = vi.fn(async (_t: string, r: FhirResource) => ({ ...r, id: 'new-1', meta: { versionId: '1', lastUpdated: '2026-11-07T12:00:00Z' } }) as FhirResource);
    const { res, body } = await call('POST', 'Encounter', {
      body: { resourceType: 'Encounter', id: 'client-chosen', status: 'planned', class: { code: 'VR' } },
      provider: stubProvider({ create }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('Location')).toBe(`${BASE}/Encounter/new-1/_history/1`);
    expect(body.id).toBe('new-1');
    expect(create.mock.calls[0][1]).not.toHaveProperty('id');
  });

  it.each([
    [{ headers: { 'Content-Type': 'text/plain' }, body: '{}' }, 415],
    [{ body: '{not json' }, 400],
    [{ body: { resourceType: 'Patient' } }, 400],
    [{ body: { resourceType: 'Encounter', class: {} } }, 400], // missing status
  ])('rejects bad create bodies %#', async (init, status) => {
    const { res, body } = await call('POST', 'Encounter', init);
    expect(res.status).toBe(status);
    expect(body.resourceType).toBe('OperationOutcome');
  });

  it('update: id must match, If-Match is parsed and passed on', async () => {
    const update = vi.fn(
      async (_t: string, id: string, r: FhirResource, _opts?: { ifMatch?: string }) =>
        ({ ...r, id, meta: { versionId: '3' } }) as FhirResource,
    );
    const enc = { resourceType: 'Encounter', id: 'e1', status: 'finished', class: { code: 'VR' } };
    const ok = await call('PUT', 'Encounter/e1', { body: enc, headers: { 'If-Match': 'W/"2"' }, provider: stubProvider({ update }) });
    expect(ok.res.status).toBe(200);
    expect(ok.res.headers.get('ETag')).toBe('W/"3"');
    expect(update.mock.calls[0][3]).toEqual({ ifMatch: '2' });

    expect((await call('PUT', 'Encounter/other', { body: enc })).res.status).toBe(400);
    expect((await call('PUT', 'Encounter/e1', { body: enc, headers: { 'If-Match': 'garbage' } })).res.status).toBe(400);
  });

  it('refuses to pass on invalid provider output (502)', async () => {
    const provider = stubProvider({ read: async () => ({ resourceType: 'Patient', id: 'p1', birthDate: 'last tuesday' }) as FhirResource });
    const { res } = await call('GET', 'Patient/p1', { provider });
    expect(res.status).toBe(502);
    const wrongId = stubProvider({ read: async () => ({ resourceType: 'Patient', id: 'someone-else' }) });
    expect((await call('GET', 'Patient/p1', { provider: wrongId })).res.status).toBe(502);
  });
});

describe('capabilityStatement', () => {
  it('lists interactions and params without naming the EHR', () => {
    const cs = capabilityStatement(caps, BASE, new Date('2026-11-07T00:00:00Z'));
    expect(cs.rest?.[0].resource?.[0]).toEqual({
      type: 'Patient',
      interaction: [{ code: 'read' }, { code: 'search-type' }],
      versioning: 'versioned',
      searchParam: [{ name: 'family', type: 'string' }],
    });
    expect(cs.implementation).toEqual({ description: 'Brevicor FHIR R4 API', url: BASE });
  });
});
