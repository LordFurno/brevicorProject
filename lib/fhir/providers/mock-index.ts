import type { CodeableConcept, FhirResource, Identifier, Reference } from 'fhir/r4';
import { FhirError } from '../outcome';
import type { InScopeType, SearchParamDef } from '../provider';
import {
  dateRange,
  defaultTimeZone,
  localReference,
  normalizeString,
  parseDateSearch,
  parseReference,
  parseToken,
  splitOrValues,
  splitParamName,
  type DateCond,
} from '../search';

/**
 * The mock provider's search index. extractSearchColumns() derives the
 * fhir_resources search columns from a resource; compileSearch() turns FHIR
 * search params into conditions on those columns. Both sides of every param
 * live here so they can't drift apart.
 */

export type MockParam =
  /** concept: a token over a CodeableConcept (system|code, or code in any system). */
  | { name: string; kind: 'id' | 'string' | 'identifier' | 'code' | 'concept' | 'date' }
  | { name: string; kind: 'reference'; targets: string[] };

const ID: MockParam = { name: '_id', kind: 'id' };

export const MOCK_SEARCH_PARAMS: Record<InScopeType, MockParam[]> = {
  Patient: [
    ID,
    { name: 'family', kind: 'string' },
    { name: 'given', kind: 'string' },
    { name: 'birthdate', kind: 'date' },
    { name: 'identifier', kind: 'identifier' },
  ],
  Practitioner: [ID, { name: 'family', kind: 'string' }, { name: 'identifier', kind: 'identifier' }],
  Organization: [ID, { name: 'identifier', kind: 'identifier' }],
  Appointment: [
    ID,
    { name: 'patient', kind: 'reference', targets: ['Patient'] },
    { name: 'practitioner', kind: 'reference', targets: ['Practitioner'] },
    {
      name: 'actor',
      kind: 'reference',
      targets: ['Patient', 'Practitioner', 'PractitionerRole', 'RelatedPerson', 'Device', 'HealthcareService', 'Location'],
    },
    { name: 'date', kind: 'date' },
    { name: 'status', kind: 'code' },
  ],
  Encounter: [
    ID,
    { name: 'patient', kind: 'reference', targets: ['Patient'] },
    { name: 'subject', kind: 'reference', targets: ['Patient', 'Group'] },
    { name: 'appointment', kind: 'reference', targets: ['Appointment'] },
    { name: 'date', kind: 'date' },
  ],
  DocumentReference: [
    ID,
    { name: 'patient', kind: 'reference', targets: ['Patient'] },
    { name: 'subject', kind: 'reference', targets: ['Patient', 'Practitioner', 'Group', 'Device'] },
    { name: 'encounter', kind: 'reference', targets: ['Encounter', 'EpisodeOfCare'] },
  ],
  Condition: [
    ID,
    { name: 'patient', kind: 'reference', targets: ['Patient'] },
    { name: 'subject', kind: 'reference', targets: ['Patient', 'Group'] },
    { name: 'clinical-status', kind: 'concept' },
  ],
  // R4 defines no `subject` search parameter on AllergyIntolerance.
  AllergyIntolerance: [ID, { name: 'patient', kind: 'reference', targets: ['Patient'] }],
  MedicationRequest: [
    ID,
    { name: 'patient', kind: 'reference', targets: ['Patient'] },
    { name: 'subject', kind: 'reference', targets: ['Patient', 'Group'] },
    { name: 'status', kind: 'code' },
  ],
  Observation: [
    ID,
    { name: 'patient', kind: 'reference', targets: ['Patient'] },
    { name: 'subject', kind: 'reference', targets: ['Patient', 'Group', 'Device', 'Location'] },
    { name: 'category', kind: 'concept' },
    { name: 'code', kind: 'concept' },
    { name: 'date', kind: 'date' },
  ],
};

const PARAM_TYPE: Record<MockParam['kind'], SearchParamDef['type']> = {
  id: 'token',
  string: 'string',
  identifier: 'token',
  code: 'token',
  concept: 'token',
  date: 'date',
  reference: 'reference',
};

export function mockSearchParamDefs(type: InScopeType): SearchParamDef[] {
  return MOCK_SEARCH_PARAMS[type].map((p) => ({ name: p.name, type: PARAM_TYPE[p.kind] }));
}

// --- Write side ---------------------------------------------------------------

export interface SearchColumns {
  refs: string[];
  tokens: string[];
  strings: string;
  date_lo: string | null;
  date_hi: string | null;
}

export interface FhirResourceRow extends SearchColumns {
  clinic_id: string;
  resource_type: string;
  id: string;
  resource: FhirResource;
  version_id: number;
  last_updated: string;
}

/** The only way rows are built: stamps meta and derives the search columns. */
export function toRow(
  clinicId: string,
  resource: FhirResource,
  versionId: number,
  lastUpdated: Date,
  timeZone = defaultTimeZone(),
): FhirResourceRow {
  if (!resource.id) throw new Error('toRow: resource has no id');
  const stamped = {
    ...resource,
    meta: { ...resource.meta, versionId: String(versionId), lastUpdated: lastUpdated.toISOString() },
  } as FhirResource;
  return {
    clinic_id: clinicId,
    resource_type: resource.resourceType,
    id: resource.id,
    resource: stamped,
    version_id: versionId,
    last_updated: lastUpdated.toISOString(),
    ...extractSearchColumns(stamped, timeZone),
  };
}

export function extractSearchColumns(resource: FhirResource, timeZone = defaultTimeZone()): SearchColumns {
  const refs = new Set<string>();
  const tokens = new Set<string>();
  const strings: string[] = [];
  let lo: string | undefined;
  let hi: string | undefined;

  const addRef = (param: string, ref: Reference | undefined): string | undefined => {
    const local = localReference(ref?.reference);
    if (local) refs.add(`${param}:${local}`);
    return local;
  };
  const addSubject = (ref: Reference | undefined): void => {
    const local = addRef('subject', ref);
    if (local?.startsWith('Patient/')) refs.add(`patient:${local}`);
  };
  const addIdentifiers = (identifiers: Identifier[] | undefined): void => {
    for (const { system, value } of identifiers ?? []) {
      if (!value) continue;
      tokens.add(`identifier:${value}`);
      tokens.add(`identifier:${system ?? ''}|${value}`);
    }
  };
  const addConcept = (param: string, concept: CodeableConcept | undefined): void => {
    for (const { system, code } of concept?.coding ?? []) {
      if (!code) continue;
      tokens.add(`${param}:${code}`);
      tokens.add(`${param}:${system ?? ''}|${code}`);
    }
  };
  const addString = (param: string, value: string | undefined): void => {
    const n = value ? normalizeString(value) : '';
    if (n) strings.push(`${param}:${n}`);
  };
  const setRange = (start: string | undefined, end: string | undefined): void => {
    if (start === undefined && end === undefined) return;
    const s = start === undefined ? undefined : dateRange(start, timeZone);
    const e = end === undefined ? undefined : dateRange(end, timeZone);
    lo = s ? s.lo.toISOString() : '-infinity';
    hi = e ? e.hi.toISOString() : 'infinity';
  };

  switch (resource.resourceType) {
    case 'Patient':
      addIdentifiers(resource.identifier);
      for (const name of resource.name ?? []) {
        addString('family', name.family);
        for (const given of name.given ?? []) addString('given', given);
      }
      setRange(resource.birthDate, resource.birthDate);
      break;
    case 'Practitioner':
      addIdentifiers(resource.identifier);
      for (const name of resource.name ?? []) addString('family', name.family);
      break;
    case 'Organization':
      addIdentifiers(resource.identifier);
      break;
    case 'Appointment':
      if (resource.status) tokens.add(`status:${resource.status}`);
      for (const participant of resource.participant ?? []) {
        const local = addRef('actor', participant.actor);
        if (local?.startsWith('Patient/')) refs.add(`patient:${local}`);
        if (local?.startsWith('Practitioner/')) refs.add(`practitioner:${local}`);
      }
      if (resource.start) setRange(resource.start, resource.start);
      break;
    case 'Encounter':
      addSubject(resource.subject);
      for (const appointment of resource.appointment ?? []) addRef('appointment', appointment);
      setRange(resource.period?.start, resource.period?.end);
      break;
    case 'DocumentReference':
      addSubject(resource.subject);
      for (const encounter of resource.context?.encounter ?? []) addRef('encounter', encounter);
      break;
    case 'Condition':
      addSubject(resource.subject);
      addConcept('clinical-status', resource.clinicalStatus);
      break;
    case 'AllergyIntolerance':
      addRef('patient', resource.patient);
      break;
    case 'MedicationRequest':
      addSubject(resource.subject);
      if (resource.status) tokens.add(`status:${resource.status}`);
      break;
    case 'Observation':
      addSubject(resource.subject);
      for (const category of resource.category ?? []) addConcept('category', category);
      addConcept('code', resource.code);
      if (resource.effectiveDateTime) setRange(resource.effectiveDateTime, resource.effectiveDateTime);
      else if (resource.effectivePeriod) setRange(resource.effectivePeriod.start, resource.effectivePeriod.end);
      else if (resource.effectiveInstant) setRange(resource.effectiveInstant, resource.effectiveInstant);
      break;
  }

  return {
    refs: [...refs],
    tokens: [...tokens],
    strings: strings.length > 0 ? `|${strings.join('|')}|` : '',
    date_lo: lo ?? null,
    date_hi: hi ?? null,
  };
}

// --- Read side ----------------------------------------------------------------

/** One AND-ed condition. Values inside a clause are OR-ed (FHIR comma semantics). */
export type Clause =
  | { column: 'id'; anyOf: string[] }
  | { column: 'refs' | 'tokens'; anyOf: string[] }
  /** Substrings of the `strings` column, e.g. "|family:smi". */
  | { column: 'strings'; anyOf: string[] }
  /** OR of ANDs over date_lo / date_hi. */
  | { column: 'date'; anyOf: DateCond[][] };

export function compileSearch(
  type: InScopeType,
  params: [string, string][],
  timeZone = defaultTimeZone(),
): Clause[] {
  return params.map(([rawName, rawValue]) => {
    const { base, modifier } = splitParamName(rawName);
    const def = MOCK_SEARCH_PARAMS[type].find((p) => p.name === base);
    if (!def) throw new FhirError(400, 'not-supported', `Search parameter '${base}' is not supported for ${type}`);
    if (modifier !== undefined && !(def.kind === 'reference' && def.targets.includes(modifier))) {
      throw new FhirError(400, 'not-supported', `Modifier ':${modifier}' is not supported on '${base}'`);
    }
    const values = splitOrValues(rawValue);

    switch (def.kind) {
      case 'id':
        return { column: 'id', anyOf: values };
      case 'string':
        return {
          column: 'strings',
          anyOf: values.map((v) => {
            const n = normalizeString(v);
            if (!n) throw new FhirError(400, 'value', `Search value for '${base}' is empty after normalisation`);
            return `|${def.name}:${n}`;
          }),
        };
      case 'identifier':
      case 'concept':
        return {
          column: 'tokens',
          anyOf: values.map((v) => {
            const t = parseToken(v);
            return t.system === undefined ? `${def.name}:${t.code}` : `${def.name}:${t.system}|${t.code}`;
          }),
        };
      case 'code':
        // Code-typed elements have an implicit system, so only the code matters.
        return { column: 'tokens', anyOf: values.map((v) => `${def.name}:${parseToken(v).code}`) };
      case 'reference':
        return {
          column: 'refs',
          anyOf: values.flatMap((v) => {
            const ref = parseReference(v, modifier);
            const types = ref.type ? def.targets.filter((t) => t === ref.type) : def.targets;
            return types.map((t) => `${def.name}:${t}/${ref.id}`);
          }),
        };
      case 'date':
        return { column: 'date', anyOf: values.flatMap((v) => parseDateSearch(v, timeZone)) };
    }
  });
}
