import 'server-only';
import type { Bundle, FhirResource, Patient, Practitioner } from 'fhir/r4';
import { patientName } from './map';
export interface GatewayContext {
  clinicId: string;
  accessToken?: string;
}
export function serviceContext(clinicId: string): GatewayContext {
  return { clinicId };
}
function baseUrl() {
  const base = process.env.FHIR_BASE_URL?.replace(/\/$/, '');
  if (!base) throw new Error('FHIR_BASE_URL is required');
  return base;
}
export async function gatewayRead<T extends FhirResource>(
  path: string,
  ctx: GatewayContext,
): Promise<T> {
  const base = baseUrl(),
    url = new URL(path, `${base}/`),
    root = new URL(`${base}/`);
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname))
    throw new Error('Invalid gateway URL');
  const token = ctx.accessToken ?? process.env.INTERNAL_SERVICE_TOKEN;
  if (!token) throw new Error('Gateway authentication is not configured');
  const response = await fetch(url, {
    headers: {
      Accept: 'application/fhir+json',
      Authorization: `Bearer ${token}`,
      'X-Clinic-Id': ctx.clinicId,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new GatewayError(response.status);
  return response.json();
}
/**
 * POST a resource through the gateway (physician token when given, so the
 * write is attributable). `ifNoneExist` makes it a conditional create: an
 * existing match is returned (created: false) instead of a duplicate.
 */
export async function gatewayCreate<T extends FhirResource>(
  resource: T,
  ctx: GatewayContext,
  opts: { ifNoneExist?: string } = {},
): Promise<{ resource: T; created: boolean }> {
  const base = baseUrl();
  const token = ctx.accessToken ?? process.env.INTERNAL_SERVICE_TOKEN;
  if (!token) throw new Error('Gateway authentication is not configured');
  const headers: Record<string, string> = {
    Accept: 'application/fhir+json',
    'Content-Type': 'application/fhir+json',
    Authorization: `Bearer ${token}`,
    'X-Clinic-Id': ctx.clinicId,
  };
  if (opts.ifNoneExist) headers['If-None-Exist'] = opts.ifNoneExist;
  const response = await fetch(`${base}/${resource.resourceType}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(resource),
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (response.status !== 201 && response.status !== 200) throw new GatewayError(response.status);
  const body = (await response.json()) as T;
  if (body.resourceType !== resource.resourceType || !body.id) throw new GatewayError(502);
  return { resource: body, created: response.status === 201 };
}

export class GatewayError extends Error {
  constructor(readonly status: number) {
    super(`Gateway unavailable (${status})`);
  }
}
export async function gatewaySearch<T extends FhirResource>(
  path: string,
  ctx: GatewayContext,
): Promise<T[]> {
  const resources: T[] = [],
    seen = new Set<string>();
  let next: string | undefined = path;
  while (next) {
    if (seen.has(next)) throw new Error('Invalid gateway pagination');
    seen.add(next);
    const bundle: Bundle = await gatewayRead<Bundle>(next, ctx);
    if (bundle.resourceType !== 'Bundle' || bundle.type !== 'searchset')
      throw new Error('Invalid gateway search response');
    for (const entry of bundle.entry ?? []) {
      if (entry.search?.mode === 'outcome' || entry.resource?.resourceType === 'OperationOutcome')
        throw new Error('Gateway returned incomplete search results');
      if (entry.resource) resources.push(entry.resource as T);
    }
    next = bundle.link?.find((l) => l.relation === 'next')?.url;
  }
  return resources;
}
export async function practitionerDisplay(ref: string, ctx: GatewayContext) {
  const p = await gatewayRead<Practitioner>(ref, ctx),
    name = patientName(p as unknown as Patient);
  return {
    id: ref.slice('Practitioner/'.length),
    ref,
    clinicId: ctx.clinicId,
    name,
    short: name.split(' ').slice(-1)[0],
    specialty: 'Physician',
    color: 'brand',
  };
}
