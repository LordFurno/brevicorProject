import type { FhirResource } from 'fhir/r4';
import { normalizeSearchBundle } from './bundle';
import { capabilityStatement } from './capability-statement';
import { logRequest, logWarning } from './log';
import { FhirError, errorCode, errorResponse, fhirJson } from './outcome';
import { resourceCapabilities, type EhrProvider, type InScopeType, type Interaction } from './provider';
import { ID_RE, parseControlParams, splitParamName } from './search';
import { validateResource } from './validate';

const TYPE_RE = /^[A-Z][A-Za-z]+$/;
const MAX_BODY_CHARS = 2_000_000;

export interface DispatchOptions {
  /** Gateway base, e.g. https://host/api/fhir/R4 */
  baseUrl: string;
  /** For logs only. */
  clinicId: string | null;
}

type Route =
  | { interaction: 'capabilities' }
  | { interaction: 'search-type'; type: string }
  | { interaction: 'create'; type: string }
  | { interaction: 'read' | 'update'; type: string; id: string };

/**
 * Handles one FHIR REST request against a provider. Framework-free: takes a
 * standard Request, returns a standard Response, never throws. Every error is
 * an OperationOutcome.
 */
export async function dispatch(
  req: Request,
  path: string[],
  getProvider: () => Promise<EhrProvider>,
  opts: DispatchOptions,
): Promise<Response> {
  const started = performance.now();
  const log: Parameters<typeof logRequest>[0] = { clinic: opts.clinicId, method: req.method, status: 0, ms: 0 };
  let res: Response;
  try {
    const provider = await getProvider();
    const route = parseRoute(req.method, path);
    log.interaction = route.interaction;
    if ('type' in route) log.type = route.type;
    if ('id' in route) log.id = route.id;
    res = await handle(req, route, provider, opts, log);
  } catch (err) {
    res = errorResponse(err);
    log.issue = errorCode(err);
  }
  log.status = res.status;
  log.ms = Math.round(performance.now() - started);
  logRequest(log);
  return res;
}

function parseRoute(method: string, path: string[]): Route {
  const [type, id, ...rest] = path;
  if (path.length === 1 && type === 'metadata') {
    if (method === 'GET') return { interaction: 'capabilities' };
    throw notSupported('This operation is not supported');
  }
  if (!type || rest.length > 0 || (id !== undefined && /^[_$]/.test(id))) {
    throw notSupported('This operation is not supported');
  }
  if (!TYPE_RE.test(type)) throw new FhirError(404, 'not-found', 'Unknown resource type');
  if (id === undefined) {
    if (method === 'GET') return { interaction: 'search-type', type };
    if (method === 'POST') return { interaction: 'create', type };
    throw notSupported(`${method} on a resource type is not supported`);
  }
  if (!ID_RE.test(id)) throw new FhirError(400, 'value', 'Invalid resource id');
  if (method === 'GET') return { interaction: 'read', type, id };
  if (method === 'PUT') return { interaction: 'update', type, id };
  throw notSupported(`${method} on a resource is not supported`);
}

async function handle(
  req: Request,
  route: Route,
  provider: EhrProvider,
  opts: DispatchOptions,
  log: Parameters<typeof logRequest>[0],
): Promise<Response> {
  const caps = await provider.capabilities();
  if (route.interaction === 'capabilities') {
    return fhirJson(capabilityStatement(caps, opts.baseUrl));
  }

  const rc = resourceCapabilities(caps, route.type);
  if (!rc || !rc.interactions.includes(route.interaction)) {
    throw notSupported(`${LABELS[route.interaction]} is not supported for ${route.type} at this clinic`);
  }
  const type = rc.type;

  switch (route.interaction) {
    case 'read': {
      const resource = await provider.read(type, route.id);
      checkOutput(resource, type, route.id, opts);
      return fhirJson(resource, 200, versionHeaders(resource));
    }

    case 'search-type': {
      const url = new URL(req.url);
      const query = parseControlParams(url.searchParams);
      log.params = query.params.map(([name]) => splitParamName(name).base);
      for (const name of log.params) {
        if (!rc.searchParams.some((p) => p.name === name)) {
          throw new FhirError(400, 'not-supported', `Search parameter '${name}' is not supported for ${type}`);
        }
      }
      const raw = await provider.search(type, query);
      const { bundle, invalidIds } = normalizeSearchBundle(raw, {
        type,
        baseUrl: opts.baseUrl,
        selfUrl: url.toString(),
        count: query.count,
        offset: query.offset,
      });
      if (invalidIds.length > 0) {
        logWarning('fhir.invalid_output', { clinic: opts.clinicId, type, ids: invalidIds });
      }
      return fhirJson(bundle);
    }

    case 'create': {
      if (!provider.create) throw notSupported(`create is not supported for ${type} at this clinic`);
      const body = await readResourceBody(req, type);
      delete (body as { id?: string }).id; // the server assigns ids on create
      const created = await provider.create(type, body);
      checkOutput(created, type, undefined, opts);
      log.id = created.id;
      const headers = versionHeaders(created);
      headers.set('Location', `${opts.baseUrl}/${type}/${created.id}/_history/${created.meta?.versionId ?? '1'}`);
      return fhirJson(created, 201, headers);
    }

    case 'update': {
      if (!provider.update) throw notSupported(`update is not supported for ${type} at this clinic`);
      const body = await readResourceBody(req, type);
      if (body.id !== route.id) {
        throw new FhirError(400, 'invalid', 'The resource id must match the id in the URL');
      }
      const ifMatch = parseIfMatch(req.headers.get('if-match'));
      const updated = await provider.update(type, route.id, body, { ifMatch });
      checkOutput(updated, type, route.id, opts);
      return fhirJson(updated, 200, versionHeaders(updated));
    }
  }
}

const LABELS: Record<Interaction, string> = {
  read: 'read',
  'search-type': 'search',
  create: 'create',
  update: 'update',
};

function notSupported(message: string): FhirError {
  return new FhirError(501, 'not-supported', message);
}

async function readResourceBody(req: Request, type: InScopeType): Promise<FhirResource> {
  const contentType = req.headers.get('content-type') ?? '';
  if (!/^application\/(fhir\+)?json\b/i.test(contentType)) {
    throw new FhirError(415, 'not-supported', 'Content-Type must be application/fhir+json');
  }
  const text = await req.text();
  if (text.length > MAX_BODY_CHARS) throw new FhirError(413, 'too-long', 'Request body is too large');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new FhirError(400, 'structure', 'Request body is not valid JSON');
  }
  const issues = validateResource(body, type);
  if (issues.length > 0) {
    throw new FhirError(400, 'invalid', 'The resource is not valid FHIR R4', issues);
  }
  return body as FhirResource;
}

/** Providers must hand back valid R4; anything else is the EHR's fault (502). */
function checkOutput(resource: FhirResource, type: string, expectedId: string | undefined, opts: DispatchOptions): void {
  const issues = validateResource(resource, type);
  if (!resource.id || (expectedId !== undefined && resource.id !== expectedId)) {
    issues.push({ severity: 'error', code: 'invalid', diagnostics: 'The returned resource has the wrong id' });
  }
  if (issues.length > 0) {
    logWarning('fhir.invalid_output', { clinic: opts.clinicId, type, ids: [resource.id ?? '(no id)'] });
    throw new FhirError(502, 'invalid', 'The EHR returned a resource that is not valid FHIR R4', issues);
  }
}

function parseIfMatch(header: string | null): string | undefined {
  if (header === null) return undefined;
  const m = /^(?:W\/)?"([A-Za-z0-9.-]{1,64})"$/.exec(header.trim());
  if (!m) throw new FhirError(400, 'value', 'If-Match must look like W/"<versionId>"');
  return m[1];
}

function versionHeaders(resource: FhirResource): Headers {
  const headers = new Headers();
  if (resource.meta?.versionId) headers.set('ETag', `W/"${resource.meta.versionId}"`);
  if (resource.meta?.lastUpdated) headers.set('Last-Modified', new Date(resource.meta.lastUpdated).toUTCString());
  return headers;
}
