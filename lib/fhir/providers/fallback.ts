import type { Bundle, BundleEntry, Coding, FhirResource } from 'fhir/r4';
import { searchset } from '../bundle';
import { LOCAL_ONLY_TAG, SYNC_STATUS_SYSTEM } from '../identifiers';
import { FhirError } from '../outcome';
import {
  supports,
  type Capabilities,
  type EhrProvider,
  type InScopeType,
  type Interaction,
  type SearchRequest,
  type UpdateOptions,
} from '../provider';

/**
 * "Never silently drop a write" (CLAUDE.md). Wraps a clinic's provider: when
 * its EHR can't create an Encounter or DocumentReference (e.g. a read-only
 * adapter), the write goes to Brevicor's docstore instead, tagged
 * meta.tag https://brevicor.ca/fhir/sync-status|local-only, meaning Brevicor
 * holds the only (authoritative) copy. Those resources are merged into the
 * clinic's reads and searches, so the app sees one record either way.
 *
 * Nothing here is EHR-specific: the decision comes from the inner provider's
 * capabilities. When the EHR supports the write itself, everything passes through.
 */

export const FALLBACK_TYPES: readonly InScopeType[] = ['Encounter', 'DocumentReference'];
const FALLBACK_INTERACTIONS: readonly Interaction[] = ['create'];

export class FallbackProvider implements EhrProvider {
  readonly update?: EhrProvider['update'];

  constructor(
    private readonly inner: EhrProvider,
    /** Brevicor's docstore for this clinic (a MockProvider over fhir_docstore). */
    private readonly store: EhrProvider,
  ) {
    if (inner.update) {
      this.update = (type: InScopeType, id: string, resource: FhirResource, options?: UpdateOptions) =>
        inner.update!(type, id, resource, options);
    }
  }

  async capabilities(): Promise<Capabilities> {
    const caps = await this.inner.capabilities();
    return {
      resources: caps.resources.map((r) => {
        if (!FALLBACK_TYPES.includes(r.type)) return r;
        const missing = FALLBACK_INTERACTIONS.filter((i) => !r.interactions.includes(i));
        // Merging needs the EHR's own read + search; without them a local copy would be unreachable.
        if (missing.length === 0 || !r.interactions.includes('read') || !r.interactions.includes('search-type')) return r;
        return { ...r, interactions: [...r.interactions, ...missing], fallback: [...(r.fallback ?? []), ...missing] };
      }),
    };
  }

  async read(type: InScopeType, id: string): Promise<FhirResource> {
    try {
      return await this.inner.read(type, id);
    } catch (err) {
      if (!(err instanceof FhirError && err.status === 404) || !(await this.usesFallback(type))) throw err;
      return this.store.read(type, id);
    }
  }

  async search(type: InScopeType, request: SearchRequest): Promise<Bundle> {
    if (!(await this.usesFallback(type))) return this.inner.search(type, request);

    // Local first for the total: it also rejects (400) any param the docstore
    // can't evaluate, so a search is never silently wider on either side.
    const local = await this.store.search(type, { params: request.params, count: 0, offset: 0 });
    const localTotal = local.total ?? 0;

    const inner = await this.inner.search(type, request);
    const innerMatches = (inner.entry ?? []).filter(isMatch);
    const others = (inner.entry ?? []).filter((e) => !isMatch(e)); // e.g. OperationOutcome entries
    const innerTotal = inner.total ?? (await this.innerTotal(type, request));
    if (request.count === 0) return searchset([], innerTotal + localTotal);

    // EHR results first, then local ones. The EHR keeps its own offsets, so
    // vendors that page on a fixed grid still get aligned requests.
    const room = request.count - innerMatches.length;
    const localStart = Math.max(0, request.offset - innerTotal);
    let localEntries: BundleEntry[] = [];
    if (room > 0 && localStart < localTotal) {
      const page = await this.store.search(type, { params: request.params, count: room, offset: localStart });
      localEntries = (page.entry ?? []).filter(isMatch);
    }
    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total: innerTotal + localTotal,
      entry: [...innerMatches, ...localEntries, ...others],
    };
  }

  async create(type: InScopeType, resource: FhirResource): Promise<FhirResource> {
    const caps = await this.inner.capabilities();
    if (supports(caps, type, 'create') && this.inner.create) return this.inner.create(type, resource);
    if (!(await this.usesFallback(type))) {
      throw new FhirError(501, 'not-supported', `create is not supported for ${type} at this clinic`);
    }
    if (!this.store.create) throw new FhirError(500, 'exception', 'The Brevicor docstore cannot store this resource');
    // Errors propagate: a failed local write is a 5xx, never a 201.
    return this.store.create(type, withLocalOnlyTag(resource));
  }

  private async usesFallback(type: InScopeType): Promise<boolean> {
    const r = (await this.capabilities()).resources.find((x) => x.type === type);
    return !!r?.fallback?.length;
  }

  /** The EHR's total when its page didn't say: ask for `_count=0`. */
  private async innerTotal(type: InScopeType, request: SearchRequest): Promise<number> {
    const probe = await this.inner.search(type, { params: request.params, count: 0, offset: 0 });
    if (probe.total === undefined) {
      // Without the EHR's total, local results can't be paged after it, and leaving them out would drop them.
      throw new FhirError(502, 'not-supported', `The clinic's EHR doesn't report search totals, so locally stored ${type} resources can't be merged`);
    }
    return probe.total;
  }
}

function isMatch(e: BundleEntry): boolean {
  return (e.search?.mode === undefined || e.search.mode === 'match') && e.resource?.resourceType !== 'OperationOutcome';
}

export function isLocalOnly(resource: FhirResource): boolean {
  return !!resource.meta?.tag?.some((t) => t.system === SYNC_STATUS_SYSTEM && t.code === LOCAL_ONLY_TAG.code);
}

function withLocalOnlyTag(resource: FhirResource): FhirResource {
  const tags: Coding[] = (resource.meta?.tag ?? []).filter((t) => t.system !== SYNC_STATUS_SYSTEM);
  return { ...resource, meta: { ...resource.meta, tag: [...tags, { ...LOCAL_ONLY_TAG }] } } as FhirResource;
}
