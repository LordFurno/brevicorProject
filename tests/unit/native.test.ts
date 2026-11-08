import type { CapabilityStatement } from 'fhir/r4';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FhirError } from '@/lib/fhir/outcome';
import type { EhrConnection } from '@/lib/fhir/provider';
import { NativeFhirProvider, capabilitiesFromStatement } from '@/lib/fhir/providers/native';

const statement: CapabilityStatement = {
  resourceType: 'CapabilityStatement',
  status: 'active',
  date: '2026-01-01',
  kind: 'instance',
  fhirVersion: '4.0.1',
  format: ['json'],
  rest: [
    {
      mode: 'server',
      searchParam: [{ name: '_lastUpdated', type: 'date' }],
      resource: [
        {
          type: 'Patient',
          interaction: [{ code: 'read' }, { code: 'search-type' }, { code: 'create' }, { code: 'delete' }],
          searchParam: [
            { name: 'family', type: 'string' },
            { name: '_id', type: 'token' },
            { name: '_include', type: 'special' },
          ],
        },
        { type: 'Encounter', interaction: [{ code: 'read' }, { code: 'update' }] },
        { type: 'ImagingStudy', interaction: [{ code: 'read' }] }, // not a gateway type
        { type: 'Appointment', interaction: [{ code: 'delete' }] },
      ],
    },
  ],
};

let n = 0;
/** Unique base per test: capabilities are cached per base URL. */
function conn(overrides: Partial<EhrConnection> = {}): EhrConnection {
  n += 1;
  return {
    clinicId: 'c',
    name: 'c',
    mode: 'fhir',
    baseUrl: `https://ehr${n}.example/fhir/`,
    auth: { type: 'none' },
    adapterConfig: null,
    readOnly: false,
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/fhir+json' } });
}

async function rejection(p: Promise<unknown>): Promise<FhirError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof FhirError)) throw new Error(`expected FhirError, got ${String(err)}`);
  return err;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('capabilitiesFromStatement', () => {
  it('keeps in-scope types and gateway interactions, merges common params', () => {
    expect(capabilitiesFromStatement(statement, false)).toEqual({
      resources: [
        {
          type: 'Patient',
          interactions: ['read', 'search-type', 'create'],
          searchParams: [
            { name: 'family', type: 'string' },
            { name: '_id', type: 'token' },
            { name: '_lastUpdated', type: 'date' },
          ],
        },
        { type: 'Encounter', interactions: ['read', 'update'], searchParams: [{ name: '_lastUpdated', type: 'date' }] },
      ],
    });
  });

  it('strips writes for read-only connections', () => {
    const caps = capabilitiesFromStatement(statement, true);
    expect(caps.resources.map((r) => [r.type, r.interactions])).toEqual([
      ['Patient', ['read', 'search-type']],
      ['Encounter', ['read']],
    ]);
  });
});

describe('NativeFhirProvider', () => {
  it('fetches /metadata once and caches it', async () => {
    const fetch = vi.fn(async () => json(statement));
    const provider = new NativeFhirProvider(conn(), fetch);
    await provider.capabilities();
    await provider.capabilities();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toMatch(/\/fhir\/metadata$/);
  });

  it('forwards search params with _count/_offset and sends bearer auth from env', async () => {
    vi.stubEnv('TEST_EHR_TOKEN', 'tok-123');
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      json({ resourceType: 'Bundle', type: 'searchset', entry: [] }),
    );
    const c = conn({ auth: { type: 'bearer', tokenEnv: 'TEST_EHR_TOKEN' } });
    await new NativeFhirProvider(c, fetch).search('Patient', {
      params: [['family', 'smith'], ['given', 'jo,al']],
      count: 5,
      offset: 10,
    });
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe(`${c.baseUrl!.replace(/\/$/, '')}/Patient?family=smith&given=jo%2Cal&_count=5&_offset=10`);
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tok-123');
  });

  it('fails closed when the bearer token env var is missing', async () => {
    const fetch = vi.fn();
    const p = new NativeFhirProvider(conn({ auth: { type: 'bearer', tokenEnv: 'NOPE_NOT_SET' } }), fetch);
    expect((await rejection(p.read('Patient', '1'))).status).toBe(500);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('makes absolute references into the EHR relative', async () => {
    const c = conn();
    const base = c.baseUrl!.replace(/\/$/, '');
    const fetch = vi.fn(async () =>
      json({ resourceType: 'Encounter', id: 'e1', subject: { reference: `${base}/Patient/p1` }, serviceProvider: { reference: 'https://other/Organization/o1' } }),
    );
    const enc = (await new NativeFhirProvider(c, fetch).read('Encounter', 'e1')) as { subject: { reference: string }; serviceProvider: { reference: string } };
    expect(enc.subject.reference).toBe('Patient/p1');
    expect(enc.serviceProvider.reference).toBe('https://other/Organization/o1');
  });

  it('maps upstream failures to gateway errors', async () => {
    const cases: [Response | Error, number, string][] = [
      [json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-found', diagnostics: 'HAPI-2001: gone' }] }, 404), 404, 'not-found'],
      [json({}, 500), 502, 'transient'],
      [json({}, 401), 502, 'security'],
      [json({}, 429), 503, 'throttled'],
      [new TypeError('fetch failed'), 502, 'transient'],
      [Object.assign(new Error('timed out'), { name: 'TimeoutError' }), 504, 'timeout'],
    ];
    for (const [result, status, code] of cases) {
      const fetch = vi.fn(async () => {
        if (result instanceof Error) throw result;
        return result;
      });
      const err = await rejection(new NativeFhirProvider(conn(), fetch).read('Patient', '1'));
      expect([err.status, err.code]).toEqual([status, code]);
      expect(err.diagnostics).not.toContain('HAPI');
    }
  });

  it('passes validation issues through on 4xx writes', async () => {
    const outcome = { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'required', diagnostics: 'Encounter.class: minimum required = 1' }] };
    const fetch = vi.fn(async () => json(outcome, 422));
    const err = await rejection(
      new NativeFhirProvider(conn(), fetch).create('Encounter', { resourceType: 'Encounter', status: 'planned', class: {} }),
    );
    expect(err.status).toBe(422);
    expect(err.issues).toEqual(outcome.issue);
  });

  it('refuses writes on read-only connections without calling the EHR', async () => {
    const fetch = vi.fn();
    const p = new NativeFhirProvider(conn({ readOnly: true }), fetch);
    expect((await rejection(p.create('Encounter', { resourceType: 'Encounter', status: 'planned', class: {} }))).status).toBe(501);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends If-Match on update', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      json({ resourceType: 'Encounter', id: 'e1', status: 'finished', class: {} }),
    );
    await new NativeFhirProvider(conn(), fetch).update('Encounter', 'e1', { resourceType: 'Encounter', id: 'e1', status: 'finished', class: {} }, { ifMatch: '4' });
    const [, init] = fetch.mock.calls[0];
    expect(init?.method).toBe('PUT');
    expect(new Headers(init?.headers).get('If-Match')).toBe('W/"4"');
  });
});
