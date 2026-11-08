import type { Bundle, CapabilityStatement, FhirResource, OperationOutcome, OperationOutcomeIssue } from 'fhir/r4';
import { FhirError } from '../outcome';
import {
  GATEWAY_INTERACTIONS,
  IN_SCOPE_TYPES,
  type Capabilities,
  type EhrConnection,
  type EhrProvider,
  type InScopeType,
  type SearchParamDef,
  type SearchRequest,
  type UpdateOptions,
} from '../provider';

const CAPS_TTL_MS = 10 * 60_000;
const DEFAULT_TIMEOUT_MS = 15_000;

/** Underscore params passed through to the EHR. Others (_include, _sort, ...) aren't part of the gateway contract. */
const PASSTHROUGH_COMMON_PARAMS = new Set(['_id', '_lastUpdated']);

const capsCache = new Map<string, { expires: number; caps: Capabilities }>();

/** An EHR that already speaks FHIR R4: requests are forwarded to its base URL. */
export class NativeFhirProvider implements EhrProvider {
  private readonly base: string;

  constructor(
    private readonly conn: EhrConnection,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    if (!conn.baseUrl) throw new FhirError(500, 'exception', 'The clinic EHR connection has no base URL');
    this.base = conn.baseUrl.replace(/\/+$/, '');
  }

  async capabilities(): Promise<Capabilities> {
    const key = `${this.base}|${this.conn.readOnly}`;
    const hit = capsCache.get(key);
    if (hit && hit.expires > Date.now()) return hit.caps;
    const statement = await this.request<CapabilityStatement>('GET', '/metadata');
    if (statement.resourceType !== 'CapabilityStatement') throw invalidUpstream();
    const caps = capabilitiesFromStatement(statement, this.conn.readOnly);
    capsCache.set(key, { expires: Date.now() + CAPS_TTL_MS, caps });
    return caps;
  }

  read(type: InScopeType, id: string): Promise<FhirResource> {
    return this.request<FhirResource>('GET', `/${type}/${encodeURIComponent(id)}`);
  }

  async search(type: InScopeType, request: SearchRequest): Promise<Bundle> {
    const query = new URLSearchParams(request.params);
    query.set('_count', String(request.count));
    // Always send _offset, even 0: servers like HAPI order results differently in
    // offset mode, so mixing a first page without it and later pages with it overlaps.
    query.set('_offset', String(request.offset));
    const bundle = await this.request<Bundle>('GET', `/${type}?${query}`);
    if (bundle.resourceType !== 'Bundle') throw invalidUpstream();
    return bundle;
  }

  async create(type: InScopeType, resource: FhirResource): Promise<FhirResource> {
    this.assertWritable();
    return this.request<FhirResource>('POST', `/${type}`, resource);
  }

  async update(type: InScopeType, id: string, resource: FhirResource, options?: UpdateOptions): Promise<FhirResource> {
    this.assertWritable();
    if (!options?.ifMatch) return this.request<FhirResource>('PUT', `/${type}/${encodeURIComponent(id)}`, resource);
    try {
      return await this.request<FhirResource>('PUT', `/${type}/${encodeURIComponent(id)}`, resource, {
        'If-Match': `W/"${options.ifMatch}"`,
      });
    } catch (err) {
      // Some servers (e.g. HAPI) answer a stale If-Match with 409; R4 says 412.
      if (err instanceof FhirError && err.status === 409) {
        throw new FhirError(412, 'conflict', `Version conflict: ${type}/${id} is not at version ${options.ifMatch}`);
      }
      throw err;
    }
  }

  private assertWritable(): void {
    if (this.conn.readOnly) throw new FhirError(501, 'not-supported', 'This clinic EHR connection is read-only');
  }

  private async request<T>(method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<T> {
    const headers = new Headers({ Accept: 'application/fhir+json', ...extra });
    if (body !== undefined) {
      headers.set('Content-Type', 'application/fhir+json');
      headers.set('Prefer', 'return=representation');
    }
    if (this.conn.auth.type === 'bearer') {
      const token = process.env[this.conn.auth.tokenEnv];
      if (!token) throw new FhirError(500, 'exception', 'EHR credentials are not configured for this clinic');
      headers.set('Authorization', `Bearer ${token}`);
    }

    let res: Response;
    try {
      res = await this.fetchImpl(this.base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new FhirError(504, 'timeout', 'The EHR did not respond in time');
      }
      throw new FhirError(502, 'transient', 'The EHR could not be reached');
    }

    const json: unknown = await res.json().catch(() => undefined);
    if (!res.ok) throw upstreamError(res.status, json);
    if (typeof json !== 'object' || json === null) throw invalidUpstream();
    return relativizeReferences(json, this.base) as T;
  }
}

/** Maps the EHR's CapabilityStatement onto what the gateway exposes. */
export function capabilitiesFromStatement(statement: CapabilityStatement, readOnly: boolean): Capabilities {
  const rest = statement.rest?.find((r) => r.mode === 'server') ?? statement.rest?.[0];
  const common = rest?.searchParam ?? [];
  return {
    resources: IN_SCOPE_TYPES.flatMap((type) => {
      const r = rest?.resource?.find((x) => x.type === type);
      if (!r) return [];
      const interactions = GATEWAY_INTERACTIONS.filter(
        (i) =>
          (r.interaction ?? []).some((x) => x.code === i) &&
          (!readOnly || i === 'read' || i === 'search-type'),
      );
      if (interactions.length === 0) return [];
      const seen = new Set<string>();
      const searchParams: SearchParamDef[] = [];
      for (const p of [...(r.searchParam ?? []), ...common]) {
        if (seen.has(p.name)) continue;
        if (p.name.startsWith('_') && !PASSTHROUGH_COMMON_PARAMS.has(p.name)) continue;
        seen.add(p.name);
        searchParams.push({ name: p.name, type: p.type });
      }
      return [{ type, interactions, searchParams }];
    }),
  };
}

function upstreamError(status: number, body: unknown): FhirError {
  switch (status) {
    case 404:
      return new FhirError(404, 'not-found', 'Resource is not known');
    case 410:
      return new FhirError(410, 'deleted', 'Resource has been deleted');
    case 400:
    case 409:
    case 412:
    case 422: {
      const issues = upstreamIssues(body);
      const code = status === 409 || status === 412 ? 'conflict' : 'invalid';
      return new FhirError(status, code, 'The EHR rejected the request', issues);
    }
    case 401:
    case 403:
      return new FhirError(502, 'security', "The EHR rejected the gateway's credentials");
    case 405:
    case 501:
      return new FhirError(501, 'not-supported', 'The EHR does not support this operation');
    case 429:
      return new FhirError(503, 'throttled', 'The EHR is rate limiting requests; retry later');
    default:
      return new FhirError(502, 'transient', 'The EHR returned an error');
  }
}

function upstreamIssues(body: unknown): OperationOutcomeIssue[] | undefined {
  const outcome = body as OperationOutcome | undefined;
  if (outcome?.resourceType !== 'OperationOutcome' || !Array.isArray(outcome.issue)) return undefined;
  return outcome.issue.map((i) => ({ severity: i.severity, code: i.code, diagnostics: i.diagnostics }));
}

function invalidUpstream(): FhirError {
  return new FhirError(502, 'invalid', 'The EHR returned an unexpected response');
}

/** Absolute references into the EHR's own base become relative "Type/id". */
function relativizeReferences(node: unknown, base: string): unknown {
  if (Array.isArray(node)) {
    node.forEach((item) => relativizeReferences(item, base));
  } else if (typeof node === 'object' && node !== null) {
    const obj = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'reference' && typeof value === 'string' && value.startsWith(`${base}/`)) {
        obj[key] = value.slice(base.length + 1);
      } else {
        relativizeReferences(value, base);
      }
    }
  }
  return node;
}
