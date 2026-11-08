import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdapterProvider, prune } from '@/lib/fhir/providers/adapter';
import { AdapterConfigError, parseVendorDefinition } from '@/lib/fhir/providers/adapter/definition';
import { VENDOR_HOOKS } from '@/lib/fhir/providers/adapter/hooks';
import { FhirError } from '@/lib/fhir/outcome';
import type { EhrConnection, InScopeType, SearchRequest } from '@/lib/fhir/provider';

const BASE = 'https://clinicsoft.test/v2/practices/unit';

const APPT = { apptId: 'a1', patientNo: 'p1', providerNo: 'd1', apptDate: '2026-11-18', startTime: '09:30', duration: 15, status: 'B', type: 'VIRT_VIDEO', reason: null };

function conn(overrides: Partial<EhrConnection> = {}): EhrConnection {
  return {
    clinicId: 'unit',
    name: 'unit',
    mode: 'adapter',
    baseUrl: null,
    auth: { type: 'apiKey', keyEnv: 'UNIT_CLINICSOFT_KEY' },
    adapterConfig: { vendor: 'clinicsoft', baseUrl: BASE },
    readOnly: true,
    ...overrides,
  };
}

type Responder = (url: URL) => { status?: number; body: unknown } | Error;

function adapter(respond: Responder, overrides: Partial<EhrConnection> = {}, definitionYaml?: string) {
  vi.stubEnv('UNIT_CLINICSOFT_KEY', 'unit-key');
  const urls: URL[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = new URL(String(input));
    urls.push(url);
    const r = respond(url);
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  const definition = definitionYaml ? parseVendorDefinition(definitionYaml, 'test.yaml') : undefined;
  return { provider: new AdapterProvider(conn(overrides), { fetch, definition }), urls, fetch };
}

const req = (params: [string, string][], count = 20, offset = 0): SearchRequest => ({ params, count, offset });
const list = (key: string, rows: unknown[], totalCount = rows.length) => ({ body: { [key]: rows, page: 1, pageSize: 20, totalCount } });

async function fhirError(p: Promise<unknown>): Promise<FhirError> {
  const err = await p.then(() => undefined, (e: unknown) => e);
  if (!(err instanceof FhirError)) throw new Error(`expected FhirError, got ${String(err)}`);
  return err;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('capabilities come from the YAML', () => {
  it('lists types, read/search, and declared params; no writes', async () => {
    const caps = await adapter(() => ({ body: {} })).provider.capabilities();
    const byType = Object.fromEntries(caps.resources.map((r) => [r.type, r]));
    expect(Object.keys(byType).sort()).toEqual(['Appointment', 'DocumentReference', 'Encounter', 'Organization', 'Patient', 'Practitioner']);
    expect(byType.Organization.interactions).toEqual(['read']);
    expect(byType.Appointment.interactions).toEqual(['read', 'search-type']);
    expect(byType.Appointment.searchParams.map((p) => p.name)).toEqual(['_id', 'patient', 'practitioner', 'actor', 'date', 'status']);
    expect(byType.Patient.searchParams.find((p) => p.name === '_id')?.type).toBe('token');
  });
});

describe('search -> vendor request', () => {
  it("today's appointments for a practitioner", async () => {
    const { provider, urls, fetch } = adapter(() => list('appointments', [APPT], 1));
    const bundle = await provider.search('Appointment', req([['practitioner', 'Practitioner/d1'], ['date', 'ge2026-11-18'], ['date', 'lt2026-11-19']]));
    expect(urls[0].pathname).toBe('/v2/practices/unit/schedule');
    expect(Object.fromEntries(urls[0].searchParams)).toEqual({ providerNo: 'd1', from: '2026-11-18', to: '2026-11-18', page: '1', pageSize: '20' });
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get('X-API-Key')).toBe('unit-key');
    expect(bundle.total).toBe(1);
    expect(bundle.entry?.[0].resource).toMatchObject({ resourceType: 'Appointment', id: 'a1', start: '2026-11-18T14:30:00Z' });
  });

  it('gt/le turn into whole-day vendor bounds', async () => {
    const { provider, urls } = adapter(() => list('appointments', []));
    await provider.search('Appointment', req([['date', 'gt2026-11-18'], ['date', 'le2026-11-20']]));
    expect(urls[0].searchParams.get('from')).toBe('2026-11-19');
    expect(urls[0].searchParams.get('to')).toBe('2026-11-20');
  });

  it('actor merges into the patient/practitioner slots', async () => {
    const { provider, urls } = adapter(() => list('appointments', []));
    await provider.search('Appointment', req([['actor', 'Patient/p1']]));
    expect(urls[0].searchParams.get('patientNo')).toBe('p1');
    await provider.search('Appointment', req([['actor', 'Practitioner/d1'], ['practitioner', 'd1']]));
    expect(urls[1].searchParams.get('providerNo')).toBe('d1');
  });

  it('status goes through the code table, comma = several codes', async () => {
    const { provider, urls } = adapter(() => list('appointments', []));
    await provider.search('Appointment', req([['status', 'booked,arrived']]));
    expect(urls[0].searchParams.get('status')).toBe('B,A');
  });

  it('family (multiple) joins; birthdate range becomes DD/MM/YYYY inclusive bounds', async () => {
    const { provider, urls } = adapter(() => list('patients', []));
    await provider.search('Patient', req([['family', 'tremblay,nguyen'], ['birthdate', 'lt1979-01-01']]));
    expect(Object.fromEntries(urls[0].searchParams)).toEqual({ lastName: 'tremblay,nguyen', dobTo: '31/12/1978', page: '1', pageSize: '20' });
  });

  it('identifier: the clinic system matches, any other system matches nothing (no vendor call)', async () => {
    const { provider, urls } = adapter(() => list('patients', []), {
      adapterConfig: { vendor: 'clinicsoft', baseUrl: BASE, config: { chartNoSystem: 'urn:clinic:mrn' } },
    });
    await provider.search('Patient', req([['identifier', 'urn:clinic:mrn|M-1']]));
    expect(urls[0].searchParams.get('chartNo')).toBe('M-1');
    const none = await provider.search('Patient', req([['identifier', 'urn:other|M-1']]));
    expect(none).toMatchObject({ total: 0, entry: [] });
    expect(urls).toHaveLength(1);
  });

  it('a status ClinicSoft never uses matches nothing without calling it', async () => {
    const { provider, urls } = adapter(() => list('appointments', []));
    expect((await provider.search('Appointment', req([['status', 'proposed']]))).total).toBe(0);
    expect(urls).toHaveLength(0);
  });

  it('_id uses the read endpoint; a vendor 404 is an empty result', async () => {
    const { provider, urls } = adapter((u) => (u.pathname.endsWith('/a1') ? { body: { appointment: APPT } } : { status: 404, body: { error: { code: 'NOT_FOUND' } } }));
    expect((await provider.search('Appointment', req([['_id', 'a1']]))).entry).toHaveLength(1);
    expect(urls[0].pathname).toBe('/v2/practices/unit/schedule/a1');
    expect((await provider.search('Appointment', req([['_id', 'nope']]))).total).toBe(0);
  });

  it('paging: _offset becomes a page number; _count=0 asks for totals only', async () => {
    const { provider, urls } = adapter(() => list('patients', [{ patientNo: 'p1', lastName: 'X' }], 41));
    await provider.search('Patient', req([['family', 'x']], 20, 40));
    expect(urls[0].searchParams.get('page')).toBe('3');
    const counted = await provider.search('Patient', req([['family', 'x']], 0));
    expect(urls[1].searchParams.get('pageSize')).toBe('1');
    expect(counted).toMatchObject({ total: 41, entry: [] });
  });
});

describe("what ClinicSoft can't express -> 400, never ignored", () => {
  it.each<[string, InScopeType, [string, string][], number?]>([
    ['several given names', 'Patient', [['given', 'a,b']]],
    ['minute-precision dates', 'Appointment', [['date', 'ge2026-11-18T10:00']]],
    ['an unsupported prefix', 'Appointment', [['date', 'ne2026-11-18']]],
    ['conflicting practitioners', 'Appointment', [['actor', 'Practitioner/d1'], ['practitioner', 'd2']]],
    ['two family conditions (AND)', 'Patient', [['family', 'a'], ['family', 'b']]],
    ['_id with other params', 'Patient', [['_id', 'p1'], ['family', 'x']]],
    ['an untyped multi-target reference', 'Appointment', [['actor', 'd1']]],
    ['a string modifier', 'Patient', [['family:exact', 'x']]],
    ['an _offset off the page grid', 'Patient', [['family', 'x']], 7],
  ])('%s', async (_label, type, params, offset = 0) => {
    const { provider, urls } = adapter(() => list('patients', []));
    const err = await fhirError(provider.search(type, req(params, 20, offset)));
    expect(err.status).toBe(400);
    expect(urls).toHaveLength(0);
  });

  it('a deliberately limited vendor rejects what its YAML does not declare', async () => {
    const yaml = `
vendor: tiny
name: TinyEMR
timezone: America/Toronto
auth: { type: apiKey, header: X-Key }
paging: { pageParam: p, sizeParam: n, maxPageSize: 10 }
resources:
  Patient:
    search:
      path: /people
      results: people
      params:
        family: { type: string }
        birthdate: { type: date, prefixes: [eq], precision: day }
      query:
        surname: "{family.value}"
        born: "{$localDate(birthdate.start)}"
    map: '{ "resourceType": "Patient", "id": id }'
`;
    const { provider } = adapter(() => ({ body: { people: [] } }), {}, yaml);
    expect((await fhirError(provider.search('Patient', req([['birthdate', 'ge1980-01-01']])))).status).toBe(400);
    expect((await fhirError(provider.search('Patient', req([['family', 'a,b']])))).status).toBe(400);
    expect((await fhirError(provider.read('Patient', 'x'))).status).toBe(501);
    expect((await provider.capabilities()).resources).toEqual([
      { type: 'Patient', interactions: ['search-type'], searchParams: [{ name: 'family', type: 'string' }, { name: 'birthdate', type: 'date' }] },
    ]);
  });
});

describe('vendor errors -> OperationOutcome', () => {
  it.each<[string, () => { status?: number; body: unknown } | Error, number, string]>([
    ['401', () => ({ status: 401, body: { error: { code: 'UNAUTHORIZED' } } }), 502, 'security'],
    ['500', () => ({ status: 500, body: {} }), 502, 'transient'],
    ['429', () => ({ status: 429, body: {} }), 503, 'throttled'],
    ['400 on a search we built', () => ({ status: 400, body: { error: { code: 'BAD_REQUEST' } } }), 502, 'exception'],
    ['network failure', () => new TypeError('fetch failed'), 502, 'transient'],
    ['timeout', () => Object.assign(new Error('t'), { name: 'TimeoutError' }), 504, 'timeout'],
  ])('%s', async (_label, respond, status, code) => {
    const err = await fhirError(adapter(respond).provider.search('Appointment', req([['patient', 'p1']])));
    expect([err.status, err.code]).toEqual([status, code]);
  });

  it('read 404 -> 404 not-found', async () => {
    const err = await fhirError(adapter(() => ({ status: 404, body: {} })).provider.read('Patient', 'gone'));
    expect([err.status, err.code]).toEqual([404, 'not-found']);
  });
});

describe('mapping failures -> 502 naming vendor + type, no PHI', () => {
  it('an unknown vendor code', async () => {
    const record = { ...APPT, status: 'X', reason: 'SECRET reason', patientNo: 'SECRET-PATIENT' };
    const err = await fhirError(adapter(() => ({ body: { appointment: record } })).provider.read('Appointment', 'a1'));
    expect(err.status).toBe(502);
    expect(err.diagnostics).toContain('ClinicSoft');
    expect(err.diagnostics).toContain('Appointment');
    expect(JSON.stringify(err.issues ?? [])).not.toContain('SECRET');
    expect(err.diagnostics).not.toContain('SECRET');
  });

  it('a record that maps to invalid FHIR (booked with no start time)', async () => {
    const record = { ...APPT, apptDate: null, startTime: null, patientNo: 'SECRET-PATIENT' };
    const err = await fhirError(adapter(() => ({ body: { appointment: record } })).provider.read('Appointment', 'a1'));
    expect([err.status, err.code]).toEqual([502, 'invalid']);
    expect(err.diagnostics).toContain('ClinicSoft');
    expect(JSON.stringify(err)).not.toContain('SECRET');
  });
});

describe('auth and configuration', () => {
  it('missing API key env var -> 500, no vendor call', async () => {
    const { provider, urls } = adapter(() => ({ body: {} }), { auth: { type: 'apiKey', keyEnv: 'UNIT_NOT_SET_KEY' } });
    expect((await fhirError(provider.read('Patient', 'p1'))).status).toBe(500);
    expect(urls).toHaveLength(0);
  });

  it('OAuth2 client credentials is a stub (501)', async () => {
    const yaml = `
vendor: oauthy
name: OAuthEMR
timezone: UTC
auth: { type: oauth2_client_credentials, tokenUrl: "https://emr.test/token" }
paging: { pageParam: p, sizeParam: n, maxPageSize: 10 }
resources:
  Patient:
    read: { path: "/p/{id}", result: p }
    map: '{ "resourceType": "Patient", "id": id }'
`;
    const { provider } = adapter(() => ({ body: {} }), { auth: { type: 'oauth2_client_credentials', clientIdEnv: 'A', clientSecretEnv: 'B' } }, yaml);
    expect((await fhirError(provider.read('Patient', 'p1'))).status).toBe(501);
  });

  it('auth type mismatch or unknown hooks -> 500 misconfigured', () => {
    expect(() => adapter(() => ({ body: {} }), { auth: { type: 'none' } })).toThrow(FhirError);
    expect(() => adapter(() => ({ body: {} }), { adapterConfig: { vendor: 'no-such-vendor', baseUrl: BASE } })).toThrow(FhirError);
  });

  it.each(['bad JSONata', 'unknown resource type', 'bad prefix'])('rejects a broken definition: %s', (label) => {
    const base = (resources: string) => `vendor: x\nname: X\ntimezone: UTC\nauth: { type: apiKey, header: K }\npaging: { pageParam: p, sizeParam: n, maxPageSize: 5 }\nresources:\n${resources}`;
    const bodies: Record<string, string> = {
      'bad JSONata': `  Patient:\n    read: { path: "/p/{id}", result: p }\n    map: '{ "resourceType": '`,
      'unknown resource type': `  Observation:\n    read: { path: "/o/{id}", result: o }\n    map: '{}'`,
      'bad prefix': `  Patient:\n    search: { path: /p, results: p, params: { birthdate: { type: date, prefixes: [ap] } } }\n    map: '{}'`,
    };
    expect(() => parseVendorDefinition(base(bodies[label]), 'broken.yaml')).toThrow(AdapterConfigError);
  });

  it('hooks: afterMap can patch a resource before validation', async () => {
    VENDOR_HOOKS['unit-hooks'] = { afterMap: (r) => ({ ...r, language: 'fr-CA' }) };
    try {
      const yaml = `
vendor: hooked
name: Hooked
timezone: UTC
hooks: unit-hooks
auth: { type: apiKey, header: K }
paging: { pageParam: p, sizeParam: n, maxPageSize: 5 }
resources:
  Patient:
    read: { path: "/p/{id}", result: p }
    map: '{ "resourceType": "Patient", "id": id }'
`;
      const { provider } = adapter(() => ({ body: { p: { id: 'p1' } } }), {}, yaml);
      expect(await provider.read('Patient', 'p1')).toMatchObject({ id: 'p1', language: 'fr-CA' });
    } finally {
      delete VENDOR_HOOKS['unit-hooks'];
    }
  });
});

describe('prune', () => {
  it('removes null/empty values so mappings can stay simple', () => {
    expect(prune({ a: null, b: '', c: [], d: {}, e: [null, 'x'], f: { g: undefined }, h: 0, i: false })).toEqual({ e: ['x'], h: 0, i: false });
  });
});
