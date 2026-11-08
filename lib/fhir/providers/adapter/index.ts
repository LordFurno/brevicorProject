import { createHash } from 'node:crypto';
import type { Bundle, FhirResource } from 'fhir/r4';
import { searchset } from '../../bundle';
import { logWarning } from '../../log';
import { FhirError } from '../../outcome';
import {
  IN_SCOPE_TYPES,
  type Capabilities,
  type EhrConnection,
  type EhrProvider,
  type InScopeType,
  type Interaction,
  type SearchParamDef,
  type SearchRequest,
} from '../../provider';
import { validateResource } from '../../validate';
import { fetchJson, upstreamFailure } from '../http';
import { createAuthStrategy, type AuthStrategy } from './auth';
import {
  AdapterConfigError,
  loadVendorDefinition,
  renderTemplate,
  type ParamDefinition,
  type ResourceDefinition,
  type VendorDefinition,
} from './definition';
import { helperBindings, MappingError } from './helpers';
import { VENDOR_HOOKS, type VendorHooks } from './hooks';
import { normalizeSearch } from './search';

/**
 * Serves a non-FHIR EHR through the FHIR contract, driven entirely by its
 * vendor definition (vendors/<name>.yaml). Read-only for now.
 */

export interface AdapterConfig {
  vendor: string;
  /** Per-clinic base URL; or name an env var with baseUrlEnv. Falls back to the definition's baseUrl. */
  baseUrl?: string;
  baseUrlEnv?: string;
  /** Overrides the definition's `config` (e.g. this clinic's identifier systems). */
  config?: Record<string, string>;
}

export interface AdapterDeps {
  fetch?: typeof fetch;
  /** Use this definition instead of loading vendors/<vendor>.yaml (tests). */
  definition?: VendorDefinition;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

const PARAM_TYPE: Record<ParamDefinition['type'], SearchParamDef['type']> = {
  id: 'token',
  string: 'string',
  token: 'token',
  reference: 'reference',
  date: 'date',
};

export class AdapterProvider implements EhrProvider {
  private readonly def: VendorDefinition;
  private readonly baseUrl: string;
  private readonly auth: AuthStrategy;
  private readonly bindings: Record<string, unknown>;
  private readonly hooks: VendorHooks;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(conn: EhrConnection, deps: AdapterDeps = {}) {
    const cfg = parseAdapterConfig(conn.adapterConfig);
    try {
      this.def = deps.definition ?? loadVendorDefinition(cfg.vendor);
    } catch (err) {
      throw misconfigured(err instanceof AdapterConfigError ? err.message : 'vendor definition could not be loaded');
    }
    const baseUrl = cfg.baseUrl ?? (cfg.baseUrlEnv ? process.env[cfg.baseUrlEnv] : undefined) ?? this.def.baseUrl;
    if (!baseUrl) throw misconfigured(`no base URL for vendor '${this.def.vendor}'`);
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.auth = createAuthStrategy(this.def.auth, conn.auth);
    this.bindings = helperBindings(this.def.timezone, this.def.codes, { ...this.def.config, ...cfg.config });
    if (this.def.hooks && !VENDOR_HOOKS[this.def.hooks]) throw misconfigured(`unknown hooks '${this.def.hooks}'`);
    this.hooks = (this.def.hooks && VENDOR_HOOKS[this.def.hooks]) || {};
    this.fetchImpl = deps.fetch ?? fetch;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Straight from the definition: a resource or interaction it doesn't describe is unsupported (501). */
  async capabilities(): Promise<Capabilities> {
    return {
      resources: IN_SCOPE_TYPES.flatMap((type) => {
        const r = this.def.resources[type];
        if (!r) return [];
        const interactions: Interaction[] = [];
        if (r.read) interactions.push('read');
        if (r.search) interactions.push('search-type');
        const searchParams = Object.entries(r.search?.params ?? {}).map(([name, p]) => ({ name, type: PARAM_TYPE[p.type] }));
        return [{ type, interactions, searchParams }];
      }),
    };
  }

  async read(type: InScopeType, id: string): Promise<FhirResource> {
    const r = this.resource(type);
    if (!r.read) throw new FhirError(501, 'not-supported', `read is not supported for ${type} at this clinic`);
    return this.map(type, r, await this.fetchOne(type, r, id));
  }

  async search(type: InScopeType, request: SearchRequest): Promise<Bundle> {
    const r = this.resource(type);
    const s = r.search;
    if (!s) throw new FhirError(501, 'not-supported', `search is not supported for ${type} at this clinic`);
    const { values, empty } = await normalizeSearch(request.params, s.params, {
      type,
      timeZone: this.def.timezone,
      codes: this.def.codes,
      bindings: this.bindings,
    });
    if (empty) return searchset([], 0);

    const byId = values._id as { value: string } | undefined;
    if (byId) {
      try {
        const resource = await this.map(type, r, await this.fetchOne(type, r, byId.value));
        return searchset(request.offset > 0 || request.count === 0 ? [] : [resource], 1);
      } catch (err) {
        if (err instanceof FhirError && err.status === 404) return searchset([], 0);
        throw err;
      }
    }

    const { pageParam, sizeParam, maxPageSize, firstPage } = this.def.paging;
    const size = request.count === 0 ? 1 : Math.min(request.count, maxPageSize);
    if (request.count > 0 && request.offset % size !== 0) {
      throw new FhirError(400, 'not-supported', `This clinic's EHR pages results in fixed pages: _offset must be a multiple of _count (${size})`);
    }
    const query = new URLSearchParams();
    for (const [name, template] of Object.entries(s.query)) {
      const value = await renderTemplate(template, values, this.bindings);
      if (value !== undefined) query.set(name, String(value));
    }
    query.set(pageParam, String(firstPage + (request.count === 0 ? 0 : request.offset / size)));
    query.set(sizeParam, String(size));
    const path = String(await renderTemplate(s.path, values, this.bindings, true));
    const body = await this.get(type, `${path}?${query}`, 'search');

    const records = asArray(await s.results.evaluate(body));
    const total = s.total ? Number(await s.total.evaluate(body)) : NaN;
    const resources = request.count === 0 ? [] : await Promise.all(records.map((record) => this.map(type, r, record)));
    return searchset(resources, Number.isFinite(total) ? total : undefined);
  }

  private resource(type: InScopeType): ResourceDefinition {
    const r = this.def.resources[type];
    if (!r) throw new FhirError(501, 'not-supported', `${type} is not supported at this clinic`);
    return r;
  }

  private async fetchOne(type: InScopeType, r: ResourceDefinition, id: string): Promise<unknown> {
    const path = String(await renderTemplate(r.read!.path, { id }, this.bindings, true));
    const body = await this.get(type, path, 'read');
    const record = await r.read!.result.evaluate(body);
    if (record === undefined || record === null) {
      throw new FhirError(502, 'invalid', `${this.def.name} returned an unexpected ${type} response`);
    }
    return record;
  }

  private async get(type: InScopeType, pathAndQuery: string, kind: 'read' | 'search'): Promise<unknown> {
    const headers = new Headers({ Accept: 'application/json', ...(await this.auth.headers()) });
    const url = new URL(this.baseUrl + pathAndQuery);
    await this.hooks.beforeRequest?.({ url, headers }, { type });
    const res = await fetchJson(this.fetchImpl, url.toString(), { method: 'GET', headers }, this.timeoutMs);
    if (res.ok) {
      if (typeof res.body !== 'object' || res.body === null) {
        throw new FhirError(502, 'invalid', `${this.def.name} returned an unexpected ${type} response`);
      }
      return res.body;
    }
    if (res.status === 404 && kind === 'read') throw new FhirError(404, 'not-found', `${type} is not known`);
    if (res.status === 400 || res.status === 404 || res.status === 422) {
      // The vendor didn't understand a request we built: an adapter/config problem, not the caller's.
      throw new FhirError(502, 'exception', `${this.def.name} rejected the gateway's ${type} request`);
    }
    throw upstreamFailure(res.status);
  }

  /** Vendor record -> validated FHIR resource. Failures name vendor + type, never field values. */
  private async map(type: InScopeType, r: ResourceDefinition, record: unknown): Promise<FhirResource> {
    let mapped: unknown;
    try {
      mapped = await r.map.evaluate(record, this.bindings);
    } catch (err) {
      const why = err instanceof MappingError ? `: ${err.message}` : (err as { code?: string }).code ? ` (${(err as { code: string }).code})` : '';
      throw new FhirError(502, 'exception', `${this.def.name} returned a ${type} record that could not be mapped to FHIR${why}`);
    }
    let resource = prune(mapped) as FhirResource | undefined;
    if (!resource || resource.resourceType !== type) {
      throw new FhirError(502, 'exception', `${this.def.name}: the ${type} mapping did not produce a ${type}`);
    }
    // Vendors without versions: a content hash is an honest weak version (changes when the record does).
    resource.meta = { ...resource.meta, versionId: resource.meta?.versionId ?? versionOf(record) };
    if (this.hooks.afterMap) resource = await this.hooks.afterMap(resource, record, { type });
    const issues = validateResource(resource, type);
    if (issues.length > 0) {
      throw new FhirError(502, 'invalid', `${this.def.name}: the ${type} mapping produced invalid FHIR R4`, issues);
    }
    return resource;
  }
}

function parseAdapterConfig(value: unknown): AdapterConfig {
  const c = (value ?? {}) as Record<string, unknown>;
  if (typeof c.vendor !== 'string') throw misconfigured('adapter_config.vendor is missing');
  const str = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : undefined);
  const config = typeof c.config === 'object' && c.config !== null ? (c.config as Record<string, string>) : undefined;
  return { vendor: c.vendor, baseUrl: str('baseUrl'), baseUrlEnv: str('baseUrlEnv'), config };
}

function misconfigured(detail: string): FhirError {
  logWarning('fhir.adapter_config', { detail });
  return new FhirError(500, 'exception', "The clinic's EHR adapter is misconfigured");
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function versionOf(record: unknown): string {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex').slice(0, 16);
}

/** Drops null/undefined/'' and empty arrays/objects (FHIR forbids empty values), returning plain JSON. */
export function prune(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return undefined;
  if (Array.isArray(value)) {
    const items = value.map(prune).filter((v) => v !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, prune(v)] as const)
      .filter(([, v]) => v !== undefined);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }
  return value;
}
