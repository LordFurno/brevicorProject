import type { Bundle, BundleEntry, FhirResource, OperationOutcomeIssue } from 'fhir/r4';
import { operationOutcome } from './outcome';
import { validateResource } from './validate';

export interface NormalizeOptions {
  type: string;
  /** Gateway base, e.g. https://host/api/fhir/R4 */
  baseUrl: string;
  /** The request URL as the caller sent it. */
  selfUrl: string;
  count: number;
  offset: number;
}

export interface NormalizedBundle {
  bundle: Bundle;
  /** Ids of entries dropped for failing validation (for logging). */
  invalidIds: string[];
}

/**
 * Rebuilds any provider's searchset into the gateway's shape, so every clinic
 * returns the same envelope: gateway fullUrls and links, match entries only,
 * and an OperationOutcome entry for anything excluded as invalid.
 */
export function normalizeSearchBundle(input: Bundle, opts: NormalizeOptions): NormalizedBundle {
  const entries: BundleEntry[] = [];
  const issues: OperationOutcomeIssue[] = [];
  const invalidIds: string[] = [];

  for (const entry of input.entry ?? []) {
    const resource = entry.resource;
    const mode = entry.search?.mode;
    if (!resource || (mode !== undefined && mode !== 'match') || resource.resourceType !== opts.type) continue;
    const problems = validateResource(resource, opts.type);
    if (!resource.id || problems.length > 0) {
      invalidIds.push(resource.id ?? '(no id)');
      issues.push({
        severity: 'warning',
        code: 'invalid',
        diagnostics: `${opts.type}/${resource.id ?? '(no id)'} was excluded: the EHR returned it in a form that is not valid FHIR R4`,
      });
      continue;
    }
    entries.push({
      fullUrl: `${opts.baseUrl}/${opts.type}/${resource.id}`,
      resource: resource as FhirResource,
      search: { mode: 'match' },
    });
  }

  if (issues.length > 0) {
    entries.push({ resource: operationOutcome(issues), search: { mode: 'outcome' } });
  }

  const upstreamHasNext = input.link?.some((l) => l.relation === 'next') ?? false;
  const seen = opts.offset + (input.entry?.length ?? 0);
  const hasNext =
    opts.count > 0 && (upstreamHasNext || (input.total !== undefined && seen < input.total));

  const link: Bundle['link'] = [{ relation: 'self', url: opts.selfUrl }];
  if (hasNext) {
    const next = new URL(opts.selfUrl);
    next.searchParams.set('_offset', String(opts.offset + opts.count));
    link.push({ relation: 'next', url: next.toString() });
  }

  const bundle: Bundle = {
    resourceType: 'Bundle',
    id: crypto.randomUUID(),
    meta: { lastUpdated: new Date().toISOString() },
    type: 'searchset',
    ...(input.total !== undefined ? { total: input.total } : {}),
    link,
    entry: entries,
  };
  return { bundle, invalidIds };
}

/** Helper for providers that build their own results. */
export function searchset(resources: FhirResource[], total?: number): Bundle {
  return {
    resourceType: 'Bundle',
    type: 'searchset',
    ...(total !== undefined ? { total } : {}),
    entry: resources.map((resource) => ({ resource, search: { mode: 'match' } })),
  };
}
