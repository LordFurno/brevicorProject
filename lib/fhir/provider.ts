import type { Bundle, FhirResource } from 'fhir/r4';

/**
 * The contract every EHR integration implements (mock, native FHIR, and the
 * phase-2 proprietary adapters). The gateway owns HTTP, tenant routing,
 * capability checks, validation and the FHIR envelope; a provider only
 * fetches/stores resources and throws FhirError (lib/fhir/outcome.ts).
 */
export interface EhrProvider {
  /** What this clinic's EHR supports. Drives /metadata and the gateway's 501/400 checks. */
  capabilities(): Promise<Capabilities>;
  /** Throws FhirError(404) when the resource doesn't exist. */
  read(type: InScopeType, id: string): Promise<FhirResource>;
  /** Returns a searchset Bundle. The gateway rebuilds links/fullUrls, so only entries + total matter. */
  search(type: InScopeType, request: SearchRequest): Promise<Bundle>;
  /** Server assigns the id. Omit when the EHR can't create anything. */
  create?(type: InScopeType, resource: FhirResource): Promise<FhirResource>;
  /** Omit when the EHR can't update anything. */
  update?(type: InScopeType, id: string, resource: FhirResource, options?: UpdateOptions): Promise<FhirResource>;
}

export const IN_SCOPE_TYPES = [
  'Patient',
  'Practitioner',
  'Organization',
  'Appointment',
  'Encounter',
  'DocumentReference',
  // Clinical history (read/search only in the contract).
  'Condition',
  'AllergyIntolerance',
  'MedicationRequest',
  'Observation',
] as const;

export type InScopeType = (typeof IN_SCOPE_TYPES)[number];

export function isInScopeType(type: string): type is InScopeType {
  return (IN_SCOPE_TYPES as readonly string[]).includes(type);
}

/** The FHIR interactions the gateway exposes. Everything else is 501. */
export type Interaction = 'read' | 'search-type' | 'create' | 'update';

export const GATEWAY_INTERACTIONS: readonly Interaction[] = ['read', 'search-type', 'create', 'update'];

export type SearchParamType =
  | 'number'
  | 'date'
  | 'string'
  | 'token'
  | 'reference'
  | 'composite'
  | 'quantity'
  | 'uri'
  | 'special';

export interface SearchParamDef {
  name: string;
  type: SearchParamType;
}

export interface ResourceCapabilities {
  type: InScopeType;
  interactions: Interaction[];
  /** Excludes control params (_count, _offset), which the gateway always handles. */
  searchParams: SearchParamDef[];
  /**
   * Interactions the gateway provides with Brevicor's docstore because the
   * EHR can't (providers/fallback.ts). Reported in /metadata as supported-with-fallback.
   */
  fallback?: Interaction[];
}

export interface Capabilities {
  resources: ResourceCapabilities[];
}

export interface SearchRequest {
  /** Non-control params in request order. Names may carry a modifier ("subject:Patient"). */
  params: [name: string, value: string][];
  count: number;
  offset: number;
}

export interface UpdateOptions {
  /** Expected current versionId (from If-Match). */
  ifMatch?: string;
}

export function resourceCapabilities(caps: Capabilities, type: string): ResourceCapabilities | undefined {
  return caps.resources.find((r) => r.type === type);
}

export function supports(caps: Capabilities, type: string, interaction: Interaction): boolean {
  return resourceCapabilities(caps, type)?.interactions.includes(interaction) ?? false;
}

// --- Clinic connections (rows of ehr_connections) ---

export type ConnectionMode = 'fhir' | 'mock' | 'adapter';

/** Credentials live in env vars; the DB only names them. */
export type ConnectionAuth =
  | { type: 'none' }
  | { type: 'bearer'; tokenEnv: string }
  | { type: 'apiKey'; keyEnv: string }
  | { type: 'oauth2_client_credentials'; clientIdEnv: string; clientSecretEnv: string };

export interface EhrConnection {
  clinicId: string;
  name: string;
  mode: ConnectionMode;
  baseUrl: string | null;
  auth: ConnectionAuth;
  adapterConfig: unknown;
  /** Never forward create/update (e.g. public test servers). */
  readOnly: boolean;
}
