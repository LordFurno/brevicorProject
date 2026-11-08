import type { Bundle, Encounter, FhirResource, Identifier } from 'fhir/r4';
import { validateResource } from '@/lib/fhir/validate';

/**
 * Pure transform from Synthea FHIR R4 output to the resources the mock keeps.
 *
 * Synthea writes one transaction Bundle per patient plus shared
 * practitionerInformation*.json / hospitalInformation*.json bundles. Inside a
 * patient bundle, references are "urn:uuid:<fullUrl>"; across bundles they are
 * conditional, e.g. "Practitioner?identifier=http://hl7.org/fhir/sid/us-npi|123".
 * Both become literal "Type/id". References to things we don't keep (Location,
 * Condition, Claim...) become logical references (identifier and/or display)
 * so every stored resource is valid R4 with no dangling links.
 */

export const KEPT_TYPES = new Set(['Patient', 'Practitioner', 'Organization', 'Encounter']);

export interface ProviderIndex {
  /** "Type|system|value" -> "Type/id" */
  byIdentifier: Map<string, string>;
  /** Kept Practitioner/Organization resources, deduped by Type/id. */
  resources: Map<string, FhirResource>;
}

export interface TransformStats {
  kept: Record<string, number>;
  droppedEncounters: number;
  unresolvedReferences: number;
  invalid: number;
}

export function emptyStats(): TransformStats {
  return { kept: {}, droppedEncounters: 0, unresolvedReferences: 0, invalid: 0 };
}

export function isProviderFile(fileName: string): boolean {
  return /^(practitionerInformation|hospitalInformation)/.test(fileName);
}

/** Builds the identifier index from practitionerInformation/hospitalInformation bundles. */
export function indexProviderBundles(bundles: Bundle<FhirResource>[]): ProviderIndex {
  const index: ProviderIndex = { byIdentifier: new Map(), resources: new Map() };
  for (const bundle of bundles) {
    for (const entry of bundle.entry ?? []) {
      const r = entry.resource;
      if (!r?.id || !KEPT_TYPES.has(r.resourceType)) continue;
      const ref = `${r.resourceType}/${r.id}`;
      index.resources.set(ref, r);
      for (const id of identifiersOf(r)) {
        if (id.system && id.value) index.byIdentifier.set(`${r.resourceType}|${id.system}|${id.value}`, ref);
      }
    }
  }
  return index;
}

/** Rewrites the provider-side resources themselves (they may reference each other). */
export function transformProviderResources(index: ProviderIndex, stats: TransformStats): FhirResource[] {
  const known = new Set(index.resources.keys());
  return finish([...index.resources.values()], new Map(), index, known, stats);
}

/** One patient bundle -> kept resources with references rewritten. */
export function transformPatientBundle(
  bundle: Bundle<FhirResource>,
  index: ProviderIndex,
  maxEncountersPerPatient: number,
  stats: TransformStats,
): FhirResource[] {
  const byFullUrl = new Map<string, string>();
  const kept: FhirResource[] = [];
  for (const entry of bundle.entry ?? []) {
    const r = entry.resource;
    if (!r?.id) continue;
    const ref = `${r.resourceType}/${r.id}`;
    if (entry.fullUrl) byFullUrl.set(entry.fullUrl, ref);
    byFullUrl.set(`urn:uuid:${r.id}`, ref);
    if (KEPT_TYPES.has(r.resourceType)) kept.push(r);
  }

  // Keep only the most recent encounters per patient.
  const encounters = kept
    .filter((r): r is Encounter => r.resourceType === 'Encounter')
    .sort((a, b) => (b.period?.start ?? '').localeCompare(a.period?.start ?? ''));
  const dropped = new Set(encounters.slice(maxEncountersPerPatient));
  stats.droppedEncounters += dropped.size;
  const selected = kept.filter((r) => !dropped.has(r as Encounter));

  const known = new Set([...selected.map((r) => `${r.resourceType}/${r.id}`), ...index.resources.keys()]);
  return finish(selected, byFullUrl, index, known, stats);
}

function finish(
  resources: FhirResource[],
  byFullUrl: Map<string, string>,
  index: ProviderIndex,
  known: Set<string>,
  stats: TransformStats,
): FhirResource[] {
  const out: FhirResource[] = [];
  for (const original of resources) {
    const r = structuredClone(original);
    rewriteReferences(r, byFullUrl, index, known, stats);
    if (validateResource(r).length > 0) {
      stats.invalid += 1;
      continue;
    }
    stats.kept[r.resourceType] = (stats.kept[r.resourceType] ?? 0) + 1;
    out.push(r);
  }
  return out;
}

function rewriteReferences(
  node: unknown,
  byFullUrl: Map<string, string>,
  index: ProviderIndex,
  known: Set<string>,
  stats: TransformStats,
): void {
  if (Array.isArray(node)) {
    for (const item of node) rewriteReferences(item, byFullUrl, index, known, stats);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const obj = node as Record<string, unknown>;
  if (typeof obj.reference === 'string') {
    rewriteOne(obj, obj.reference, byFullUrl, index, known, stats);
  }
  for (const [key, value] of Object.entries(obj)) {
    if (key !== 'reference') rewriteReferences(value, byFullUrl, index, known, stats);
  }
}

function rewriteOne(
  ref: Record<string, unknown>,
  value: string,
  byFullUrl: Map<string, string>,
  index: ProviderIndex,
  known: Set<string>,
  stats: TransformStats,
): void {
  let target: string | undefined;
  let identifier: Identifier | undefined;
  let typeName: string | undefined;

  const conditional = /^([A-Z][A-Za-z]+)\?identifier=(.+)$/.exec(value);
  if (value.startsWith('urn:uuid:')) {
    target = byFullUrl.get(value);
    typeName = target?.split('/')[0];
  } else if (conditional) {
    typeName = conditional[1];
    const token = decodeURIComponent(conditional[2]);
    const bar = token.indexOf('|');
    identifier = bar === -1 ? { value: token } : { system: token.slice(0, bar), value: token.slice(bar + 1) };
    target = index.byIdentifier.get(`${typeName}|${identifier.system}|${identifier.value}`);
  } else if (/^[A-Z][A-Za-z]+\/[A-Za-z0-9.-]{1,64}$/.test(value)) {
    target = value;
    typeName = value.split('/')[0];
  }

  if (target && known.has(target)) {
    ref.reference = target;
    return;
  }

  // Not imported: keep what we know as a logical reference.
  stats.unresolvedReferences += 1;
  delete ref.reference;
  if (identifier && ref.identifier === undefined) ref.identifier = identifier;
  if (typeof ref.display !== 'string') ref.display = `${typeName ?? 'Resource'} (not imported)`;
}

function identifiersOf(r: FhirResource): Identifier[] {
  const ids = (r as { identifier?: unknown }).identifier;
  return Array.isArray(ids) ? (ids as Identifier[]) : [];
}
