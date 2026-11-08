import type { Bundle, Encounter, FhirResource, Identifier, Medication, MedicationRequest, Observation, Patient } from 'fhir/r4';
import { validateResource } from '@/lib/fhir/validate';
import { hcnIdentifier, syntheticHcn } from './hcn';

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

export const KEPT_TYPES = new Set([
  'Patient',
  'Practitioner',
  'Organization',
  'Encounter',
  'Condition',
  'AllergyIntolerance',
  'MedicationRequest',
  'Observation',
]);

/**
 * How much clinical history the mock keeps per patient (the ClinicSoft loader
 * applies the same rules to Synthea's CSV): every Condition and allergy,
 * MedicationRequests authored in the last `medicationYears`, and only
 * vital-signs/laboratory Observations, the latest `observationsPerCode` per LOINC code.
 */
export interface ClinicalCaps {
  now: Date;
  medicationYears: number;
  observationCategories: string[];
  observationsPerCode: number;
}

export function defaultCaps(now = new Date()): ClinicalCaps {
  return { now, medicationYears: 2, observationCategories: ['vital-signs', 'laboratory'], observationsPerCode: 3 };
}

/** Start of the medication window: `now` minus N calendar years. */
export function medicationCutoff(caps: ClinicalCaps): Date {
  const d = new Date(caps.now);
  d.setUTCFullYear(d.getUTCFullYear() - caps.medicationYears);
  return d;
}

const LOINC = 'http://loinc.org';
const OBS_CATEGORY = 'http://terminology.hl7.org/CodeSystem/observation-category';

export interface ProviderIndex {
  /** "Type|system|value" -> "Type/id" */
  byIdentifier: Map<string, string>;
  /** Kept Practitioner/Organization resources, deduped by Type/id. */
  resources: Map<string, FhirResource>;
}

export interface TransformStats {
  kept: Record<string, number>;
  droppedEncounters: number;
  /** Dropped by the clinical caps, per type. */
  droppedByCap: Record<string, number>;
  unresolvedReferences: number;
  invalid: number;
}

export function emptyStats(): TransformStats {
  return { kept: {}, droppedEncounters: 0, droppedByCap: {}, unresolvedReferences: 0, invalid: 0 };
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
  caps: ClinicalCaps = defaultCaps(),
): FhirResource[] {
  const byFullUrl = new Map<string, string>();
  const medications = new Map<string, Medication>();
  let kept: FhirResource[] = [];
  for (const entry of bundle.entry ?? []) {
    const r = entry.resource;
    if (!r?.id) continue;
    const ref = `${r.resourceType}/${r.id}`;
    if (entry.fullUrl) byFullUrl.set(entry.fullUrl, ref);
    byFullUrl.set(`urn:uuid:${r.id}`, ref);
    if (r.resourceType === 'Medication') medications.set(ref, r);
    if (r.resourceType === 'Patient') kept.push(withSyntheticHcn(withoutContacts(r)));
    else if (KEPT_TYPES.has(r.resourceType)) kept.push(r);
  }
  kept = applyClinicalCaps(kept, caps, stats).map((r) =>
    r.resourceType === 'MedicationRequest' ? inlineMedication(r, byFullUrl, medications) : r,
  );

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

function drop(stats: TransformStats, type: string): void {
  stats.droppedByCap[type] = (stats.droppedByCap[type] ?? 0) + 1;
}

/** Applies the MedicationRequest window and the Observation category/per-code caps. */
function applyClinicalCaps(resources: FhirResource[], caps: ClinicalCaps, stats: TransformStats): FhirResource[] {
  const cutoff = medicationCutoff(caps).getTime();
  const observationsByCode = new Map<string, Observation[]>();
  const out: FhirResource[] = [];
  for (const r of resources) {
    if (r.resourceType === 'MedicationRequest') {
      const authored = r.authoredOn ? Date.parse(r.authoredOn) : NaN;
      if (authored >= cutoff) out.push(r);
      else drop(stats, r.resourceType);
    } else if (r.resourceType === 'Observation') {
      const code = loincCode(r);
      if (code && observationCategory(r, caps)) observationsByCode.set(code, [...(observationsByCode.get(code) ?? []), r]);
      else drop(stats, r.resourceType);
    } else {
      out.push(r);
    }
  }
  for (const list of observationsByCode.values()) {
    list.sort((a, b) => observationTime(b) - observationTime(a));
    out.push(...list.slice(0, caps.observationsPerCode));
    for (const _ of list.slice(caps.observationsPerCode)) drop(stats, 'Observation');
  }
  return out;
}

export function loincCode(o: Observation): string | undefined {
  return o.code.coding?.find((c) => c.system === LOINC && c.code)?.code;
}

function observationCategory(o: Observation, caps: ClinicalCaps): boolean {
  return !!o.category?.some((cat) =>
    cat.coding?.some((c) => c.system === OBS_CATEGORY && caps.observationCategories.includes(c.code ?? '')),
  );
}

function observationTime(o: Observation): number {
  const t = Date.parse(o.effectiveDateTime ?? o.effectivePeriod?.start ?? o.issued ?? '');
  return Number.isNaN(t) ? -Infinity : t;
}

/**
 * Medication isn't a gateway type, so a MedicationRequest that points at a
 * Medication in the same bundle gets that Medication's code inline
 * (medicationCodeableConcept), the way most EHRs expose it.
 */
function inlineMedication(r: MedicationRequest, byFullUrl: Map<string, string>, medications: Map<string, Medication>): MedicationRequest {
  const ref = r.medicationReference?.reference;
  if (!ref) return r;
  const medication = medications.get(byFullUrl.get(ref) ?? ref);
  if (!medication?.code) return r;
  const { medicationReference: _ref, ...rest } = r;
  return { ...rest, medicationCodeableConcept: medication.code };
}

/** Adds a synthetic Ontario health card number (always fails the check digit). */
function withSyntheticHcn(patient: Patient): Patient {
  return { ...patient, identifier: [...(patient.identifier ?? []), hcnIdentifier(syntheticHcn(patient.id!))] };
}

/**
 * Synthea phone numbers (and any emails) are random and may belong to real
 * people, so patients are imported without them; the seed assigns
 * DEMO_PHONE_NUMBERS / DEMO_EMAILS instead.
 */
function withoutContacts(patient: Patient): Patient {
  const telecom = (patient.telecom ?? []).filter((t) => t.system !== 'phone' && t.system !== 'email');
  const { telecom: _all, ...rest } = patient;
  return telecom.length > 0 ? { ...rest, telecom } : rest;
}

function identifiersOf(r: FhirResource): Identifier[] {
  const ids = (r as { identifier?: unknown }).identifier;
  return Array.isArray(ids) ? (ids as Identifier[]) : [];
}
