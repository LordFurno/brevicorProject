import type { Bundle, Encounter, FhirResource } from 'fhir/r4';
import { describe, expect, it } from 'vitest';
import { dispatch } from '@/lib/fhir/dispatch';
import { FhirError } from '@/lib/fhir/outcome';
import type { Capabilities, EhrProvider, InScopeType, Interaction, SearchRequest } from '@/lib/fhir/provider';
import { FallbackProvider, isLocalOnly } from '@/lib/fhir/providers/fallback';

const BASE = 'https://gw.example/api/fhir/R4';

/** A tiny in-memory provider: `patient` and `appointment` searches, offset paging, totals. */
class MemoryProvider implements EhrProvider {
  creates = 0;
  create?: EhrProvider['create'];
  constructor(
    private readonly interactions: Partial<Record<InScopeType, Interaction[]>>,
    readonly rows: FhirResource[] = [],
    private readonly opts: { omitTotal?: boolean; failCreate?: boolean } = {},
  ) {
    if (Object.values(interactions).some((i) => i?.includes('create'))) {
      this.create = async (_type, resource) => {
        if (this.opts.failCreate) throw new Error('database unavailable');
        this.creates += 1;
        const made = { ...resource, id: `new-${this.rows.length + 1}`, meta: { ...resource.meta, versionId: '1' } } as FhirResource;
        this.rows.push(made);
        return made;
      };
    }
  }
  async capabilities(): Promise<Capabilities> {
    return {
      resources: Object.entries(this.interactions).map(([type, interactions]) => ({
        type: type as InScopeType,
        interactions: interactions!,
        searchParams: [{ name: 'patient', type: 'reference' }, { name: 'appointment', type: 'reference' }],
      })),
    };
  }
  async read(type: InScopeType, id: string) {
    const r = this.rows.find((x) => x.resourceType === type && x.id === id);
    if (!r) throw new FhirError(404, 'not-found', 'not known');
    return r;
  }
  async search(type: InScopeType, req: SearchRequest): Promise<Bundle> {
    const hits = this.rows.filter(
      (r) =>
        r.resourceType === type &&
        req.params.every(([name, value]) => {
          const e = r as Encounter;
          if (name === 'patient') return e.subject?.reference === value;
          if (name === 'appointment') return e.appointment?.some((a) => a.reference === value);
          throw new FhirError(400, 'not-supported', `unknown ${name}`);
        }),
    );
    const page = req.count === 0 ? [] : hits.slice(req.offset, req.offset + req.count);
    return {
      resourceType: 'Bundle',
      type: 'searchset',
      ...(this.opts.omitTotal ? {} : { total: hits.length }),
      entry: page.map((resource) => ({ resource, search: { mode: 'match' } })),
    };
  }
}

const enc = (id: string, patient = 'Patient/p1', appointment?: string): Encounter => ({
  resourceType: 'Encounter',
  id,
  status: 'finished',
  class: { code: 'AMB' },
  subject: { reference: patient },
  ...(appointment ? { appointment: [{ reference: appointment }] } : {}),
});

const READ_ONLY = { Encounter: ['read', 'search-type'], DocumentReference: ['read', 'search-type'], Condition: ['read', 'search-type'] } as const;
const STORE = { Encounter: ['read', 'search-type', 'create'], DocumentReference: ['read', 'search-type', 'create'] } as const;

function setup(inner: MemoryProvider, store = new MemoryProvider({ ...STORE } as never)) {
  return { provider: new FallbackProvider(inner, store), inner, store };
}

async function call(provider: EhrProvider, method: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) {
  const url = `${BASE}/${path}`;
  const req = new Request(url, {
    method,
    headers: init.body !== undefined ? { 'Content-Type': 'application/fhir+json', ...init.headers } : init.headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const res = await dispatch(req, new URL(url).pathname.replace('/api/fhir/R4/', '').split('/'), async () => ({ provider, clinicId: 't' }), { baseUrl: BASE });
  return { res, body: await res.json() };
}

describe('FallbackProvider capabilities', () => {
  it('adds create for Encounter/DocumentReference only when the EHR lacks it, and marks it', async () => {
    const { provider } = setup(new MemoryProvider({ ...READ_ONLY } as never));
    const caps = await provider.capabilities();
    const of = (t: string) => caps.resources.find((r) => r.type === t)!;
    expect(of('Encounter')).toMatchObject({ interactions: ['read', 'search-type', 'create'], fallback: ['create'] });
    expect(of('DocumentReference').fallback).toEqual(['create']);
    expect(of('Condition').interactions).toEqual(['read', 'search-type']);
    expect(of('Condition').fallback).toBeUndefined();
  });

  it('passes through when the EHR can write itself', async () => {
    const { provider, inner, store } = setup(new MemoryProvider({ Encounter: ['read', 'search-type', 'create'] }));
    expect((await provider.capabilities()).resources[0].fallback).toBeUndefined();
    const made = await provider.create('Encounter', enc('x'));
    expect(inner.creates).toBe(1);
    expect(store.creates).toBe(0);
    expect(isLocalOnly(made)).toBe(false);
  });

  it('reports the fallback in the CapabilityStatement', async () => {
    const { provider } = setup(new MemoryProvider({ ...READ_ONLY } as never));
    const { body } = await call(provider, 'GET', 'metadata');
    const create = body.rest[0].resource.find((r: { type: string }) => r.type === 'Encounter').interaction.find((i: { code: string }) => i.code === 'create');
    expect(create.extension).toEqual([{ url: 'https://brevicor.ca/fhir/StructureDefinition/capability-fallback', valueCode: 'local-only' }]);
    expect(create.documentation).toMatch(/Supported with fallback/);
  });
});

describe('FallbackProvider writes and reads', () => {
  it('stores the write locally, tagged local-only, and reads it back through the gateway', async () => {
    const { provider, store } = setup(new MemoryProvider({ ...READ_ONLY } as never));
    const made = await call(provider, 'POST', 'Encounter', { body: { resourceType: 'Encounter', status: 'in-progress', class: { code: 'VR' }, subject: { reference: 'Patient/p1' } } });
    expect(made.res.status).toBe(201);
    expect(made.body.meta.tag).toEqual([{ system: 'https://brevicor.ca/fhir/sync-status', code: 'local-only', display: 'Stored by Brevicor only (not in the EHR)' }]);
    expect(store.creates).toBe(1);
    const read = await call(provider, 'GET', `Encounter/${made.body.id}`);
    expect(read.res.status).toBe(200);
    expect(read.body.id).toBe(made.body.id);
  });

  it('a failed local write is an error, never a 201', async () => {
    const { provider } = setup(new MemoryProvider({ ...READ_ONLY } as never), new MemoryProvider({ ...STORE } as never, [], { failCreate: true }));
    const made = await call(provider, 'POST', 'Encounter', { body: { resourceType: 'Encounter', status: 'in-progress', class: { code: 'VR' } } });
    expect(made.res.status).toBe(500);
    expect(made.body.resourceType).toBe('OperationOutcome');
  });

  it('other read errors are not masked by the docstore', async () => {
    const inner = new MemoryProvider({ ...READ_ONLY } as never);
    inner.read = async () => {
      throw new FhirError(503, 'throttled', 'busy');
    };
    const { provider } = setup(inner);
    await expect(provider.read('Encounter', 'x')).rejects.toMatchObject({ status: 503 });
  });

  it('types without a fallback still answer 501 for create', async () => {
    const { provider } = setup(new MemoryProvider({ ...READ_ONLY } as never));
    const res = await call(provider, 'POST', 'Condition', { body: { resourceType: 'Condition', subject: { reference: 'Patient/p1' } } });
    expect(res.res.status).toBe(501);
  });
});

describe('FallbackProvider search merging', () => {
  const inner = () => new MemoryProvider({ ...READ_ONLY } as never, [enc('e1'), enc('e2'), enc('e3'), enc('other', 'Patient/p2')]);
  const store = () => new MemoryProvider({ ...STORE } as never, [enc('l1'), enc('l2')]);

  it('appends local results after the EHR, paging exactly with totals', async () => {
    const { provider } = setup(inner(), store());
    const page = async (offset: number) => {
      const b = await provider.search('Encounter', { params: [['patient', 'Patient/p1']], count: 2, offset });
      return { ids: (b.entry ?? []).map((e) => e.resource!.id), total: b.total };
    };
    expect(await page(0)).toEqual({ ids: ['e1', 'e2'], total: 5 });
    expect(await page(2)).toEqual({ ids: ['e3', 'l1'], total: 5 });
    expect(await page(4)).toEqual({ ids: ['l2'], total: 5 });
    expect(await page(6)).toEqual({ ids: [], total: 5 });
    const count = await provider.search('Encounter', { params: [['patient', 'Patient/p1']], count: 0, offset: 0 });
    expect(count.total).toBe(5);
  });

  it('follows gateway next links across EHR and local results', async () => {
    const { provider } = setup(inner(), store());
    const seen: string[] = [];
    let url: string | undefined = 'Encounter?patient=Patient/p1&_count=2';
    while (url) {
      const { body } = await call(provider, 'GET', url.replace(`${BASE}/`, ''));
      seen.push(...body.entry.map((e: { resource: { id: string } }) => e.resource.id));
      url = body.link.find((l: { relation: string }) => l.relation === 'next')?.url;
    }
    expect(seen).toEqual(['e1', 'e2', 'e3', 'l1', 'l2']);
  });

  it("asks for the EHR's total when a page omits it, and refuses to merge without one", async () => {
    const noTotal = new MemoryProvider({ ...READ_ONLY } as never, [enc('e1')], { omitTotal: true });
    const { provider } = setup(noTotal, store());
    await expect(provider.search('Encounter', { params: [['patient', 'Patient/p1']], count: 10, offset: 0 })).rejects.toMatchObject({ status: 502 });
  });

  it('a param the docstore cannot evaluate is a 400, not a wider search', async () => {
    const { provider } = setup(inner(), store());
    await expect(provider.search('Encounter', { params: [['date', '2026-01-01']], count: 10, offset: 0 })).rejects.toMatchObject({ status: 400 });
  });

  it('types without a fallback are not merged', async () => {
    const st = store();
    st.rows.push({ resourceType: 'DocumentReference', id: 'd1', status: 'current', content: [{ attachment: {} }] } as FhirResource);
    const { provider } = setup(new MemoryProvider({ Encounter: ['read', 'search-type', 'create'] }, [enc('e1')]), st);
    const b = await provider.search('Encounter', { params: [['patient', 'Patient/p1']], count: 10, offset: 0 });
    expect((b.entry ?? []).map((e) => e.resource!.id)).toEqual(['e1']);
  });
});

describe('conditional create (If-None-Exist)', () => {
  const body = { resourceType: 'Encounter', status: 'in-progress', class: { code: 'VR' }, subject: { reference: 'Patient/p1' }, appointment: [{ reference: 'Appointment/a1' }] };
  const writable = () => new MemoryProvider({ Encounter: ['read', 'search-type', 'create'] }, [enc('dup1', 'Patient/p1', 'Appointment/dup'), enc('dup2', 'Patient/p1', 'Appointment/dup')]);

  it('creates when nothing matches, then returns the existing one (200) instead of a duplicate', async () => {
    const provider = writable();
    const headers = { 'If-None-Exist': 'appointment=Appointment/a1' };
    const first = await call(provider, 'POST', 'Encounter', { body, headers });
    expect(first.res.status).toBe(201);
    const second = await call(provider, 'POST', 'Encounter', { body, headers });
    expect(second.res.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(provider.creates).toBe(1);
  });

  it('more than one match is 412; unsupported or empty criteria are 400', async () => {
    const provider = writable();
    expect((await call(provider, 'POST', 'Encounter', { body, headers: { 'If-None-Exist': 'appointment=Appointment/dup' } })).res.status).toBe(412);
    expect((await call(provider, 'POST', 'Encounter', { body, headers: { 'If-None-Exist': 'identifier=x|1' } })).res.status).toBe(400);
    expect((await call(provider, 'POST', 'Encounter', { body, headers: { 'If-None-Exist': '_count=1' } })).res.status).toBe(400);
    expect(provider.creates).toBe(0);
  });

  it('works through the docstore fallback (local matches count)', async () => {
    const { provider, store } = setup(new MemoryProvider({ ...READ_ONLY } as never));
    const headers = { 'If-None-Exist': 'appointment=Appointment/a1' };
    const first = await call(provider, 'POST', 'Encounter', { body, headers });
    const second = await call(provider, 'POST', 'Encounter', { body, headers });
    expect([first.res.status, second.res.status]).toEqual([201, 200]);
    expect(second.body.id).toBe(first.body.id);
    expect(store.creates).toBe(1);
  });
});
