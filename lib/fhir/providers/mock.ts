import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Bundle, FhirResource } from 'fhir/r4';
import { searchset } from '../bundle';
import { FhirError } from '../outcome';
import {
  IN_SCOPE_TYPES,
  type Capabilities,
  type EhrProvider,
  type InScopeType,
  type Interaction,
  type SearchRequest,
  type UpdateOptions,
} from '../provider';
import { defaultTimeZone, type DateCond } from '../search';
import { compileSearch, mockSearchParamDefs, toRow, type Clause } from './mock-index';

export const FHIR_RESOURCES_TABLE = 'fhir_resources';
/** Brevicor's own store for writes a clinic's EHR can't take (same columns as fhir_resources). */
export const FHIR_DOCSTORE_TABLE = 'fhir_docstore';

/**
 * What the mock EHR supports: the required operations from spec §4H, plus
 * Organization reads so Synthea's serviceProvider references resolve.
 * Widen here if the app needs more.
 */
export const MOCK_INTERACTIONS: Record<InScopeType, Interaction[]> = {
  // Patient/Appointment create: self-service booking into the demo EHR.
  Patient: ['read', 'search-type', 'create'],
  Practitioner: ['read', 'search-type'],
  Organization: ['read', 'search-type'],
  Appointment: ['read', 'search-type', 'create'],
  Encounter: ['read', 'search-type', 'create', 'update'],
  DocumentReference: ['read', 'search-type', 'create'],
  Condition: ['read', 'search-type'],
  AllergyIntolerance: ['read', 'search-type'],
  MedicationRequest: ['read', 'search-type'],
  Observation: ['read', 'search-type'],
};

export interface MockStoreOptions {
  /** Defaults to fhir_resources (the mock EHR). The docstore uses fhir_docstore. */
  table?: string;
  /** Defaults to MOCK_INTERACTIONS. */
  interactions?: Partial<Record<InScopeType, Interaction[]>>;
}

/**
 * Synthetic data in Supabase (fhir_resources), scoped to one clinic. The same
 * engine backs Brevicor's docstore (fhir_docstore), see providers/fallback.ts.
 */
export class MockProvider implements EhrProvider {
  private readonly table: string;
  private readonly interactions: Partial<Record<InScopeType, Interaction[]>>;

  constructor(
    private readonly db: SupabaseClient,
    private readonly clinicId: string,
    private readonly timeZone = defaultTimeZone(),
    options: MockStoreOptions = {},
  ) {
    this.table = options.table ?? FHIR_RESOURCES_TABLE;
    this.interactions = options.interactions ?? MOCK_INTERACTIONS;
  }

  async capabilities(): Promise<Capabilities> {
    return {
      resources: IN_SCOPE_TYPES.filter((type) => this.interactions[type]?.length).map((type) => ({
        type,
        interactions: [...this.interactions[type]!],
        searchParams: mockSearchParamDefs(type),
      })),
    };
  }

  async read(type: InScopeType, id: string): Promise<FhirResource> {
    const { data, error } = await this.rows()
      .select('resource')
      .eq('clinic_id', this.clinicId)
      .eq('resource_type', type)
      .eq('id', id)
      .maybeSingle();
    if (error) throw dbError(error);
    if (!data) throw new FhirError(404, 'not-found', `${type}/${id} is not known`);
    return data.resource as FhirResource;
  }

  async search(type: InScopeType, request: SearchRequest): Promise<Bundle> {
    const clauses = compileSearch(type, request.params, this.timeZone);
    const run = (head: boolean) => {
      let q = this.rows()
        .select('resource', { count: 'exact', head })
        .eq('clinic_id', this.clinicId)
        .eq('resource_type', type);
      for (const clause of clauses) q = applyClause(q, clause);
      return q;
    };

    if (request.count === 0) {
      const { count, error } = await run(true);
      if (error) throw dbError(error);
      return searchset([], count ?? 0);
    }

    const { data, count, error } = await run(false)
      .order('date_lo', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(request.offset, request.offset + request.count - 1);
    if (error?.code === 'PGRST103') {
      // Offset past the end: an empty page, but still report the total.
      const total = await run(true);
      if (total.error) throw dbError(total.error);
      return searchset([], total.count ?? 0);
    }
    if (error) throw dbError(error);
    return searchset(
      (data ?? []).map((row) => row.resource as FhirResource),
      count ?? undefined,
    );
  }

  async create(type: InScopeType, resource: FhirResource): Promise<FhirResource> {
    this.assertSupported(type, 'create');
    const row = toRow(this.clinicId, { ...resource, id: crypto.randomUUID() }, 1, new Date(), this.timeZone);
    const { error } = await this.rows().insert(row);
    if (error) throw dbError(error);
    return row.resource;
  }

  async update(type: InScopeType, id: string, resource: FhirResource, options?: UpdateOptions): Promise<FhirResource> {
    this.assertSupported(type, 'update');
    const { data: current, error: readError } = await this.rows()
      .select('version_id')
      .eq('clinic_id', this.clinicId)
      .eq('resource_type', type)
      .eq('id', id)
      .maybeSingle();
    if (readError) throw dbError(readError);
    if (!current) throw new FhirError(404, 'not-found', `${type}/${id} is not known`);

    const currentVersion = current.version_id as number;
    if (options?.ifMatch !== undefined && options.ifMatch !== String(currentVersion)) {
      throw new FhirError(412, 'conflict', `Version conflict: ${type}/${id} is at version ${currentVersion}`);
    }

    const row = toRow(this.clinicId, { ...resource, id }, currentVersion + 1, new Date(), this.timeZone);
    // Compare-and-swap on version_id so concurrent updates can't silently overwrite each other.
    const { data: updated, error } = await this.rows()
      .update(row)
      .eq('clinic_id', this.clinicId)
      .eq('resource_type', type)
      .eq('id', id)
      .eq('version_id', currentVersion)
      .select('id');
    if (error) throw dbError(error);
    if (!updated || updated.length === 0) {
      throw new FhirError(409, 'conflict', `${type}/${id} was modified concurrently; retry`);
    }
    return row.resource;
  }

  private rows() {
    return this.db.from(this.table);
  }

  private assertSupported(type: InScopeType, interaction: Interaction): void {
    if (!this.interactions[type]?.includes(interaction)) {
      throw new FhirError(501, 'not-supported', `${interaction} is not supported for ${type} at this clinic`);
    }
  }
}

/** The slice of PostgREST's filter builder that search uses. */
interface Filterable {
  in(column: string, values: readonly string[]): this;
  overlaps(column: string, value: string): this;
  or(filters: string): this;
  filter(column: string, operator: string, value: unknown): this;
}

function applyClause<Q extends Filterable>(q: Q, clause: Clause): Q {
  switch (clause.column) {
    case 'id':
      return q.in('id', clause.anyOf);
    case 'refs':
    case 'tokens':
      return q.overlaps(clause.column, pgArray(clause.anyOf));
    case 'strings':
      return q.or(clause.anyOf.map((s) => `strings.like.${quote(`*${s}*`)}`).join(','));
    case 'date': {
      const [only, ...more] = clause.anyOf;
      if (only && more.length === 0) {
        for (const cond of only) q = q.filter(dateColumn(cond), cond.op, cond.at.toISOString());
        return q;
      }
      const branches = clause.anyOf.map((conj) =>
        conj.length === 1 ? dateFilter(conj[0]) : `and(${conj.map(dateFilter).join(',')})`,
      );
      return q.or(branches.join(','));
    }
  }
}

function dateColumn(cond: DateCond): string {
  return cond.bound === 'lo' ? 'date_lo' : 'date_hi';
}

function dateFilter(cond: DateCond): string {
  return `${dateColumn(cond)}.${cond.op}.${quote(cond.at.toISOString())}`;
}

/** Double-quoted value for PostgREST logic trees. */
function quote(value: string): string {
  return `"${value.replace(/["\\]/g, '\\$&')}"`;
}

/** Postgres array literal with every element quoted (postgrest-js doesn't). */
function pgArray(values: string[]): string {
  return `{${values.map(quote).join(',')}}`;
}

function dbError(error: PostgrestError): FhirError {
  // Postgres messages can echo values; keep them out of responses.
  return new FhirError(500, 'exception', `Datastore error (${error.code || 'unknown'})`);
}
