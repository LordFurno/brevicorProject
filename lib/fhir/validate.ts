import type { OperationOutcomeIssue } from 'fhir/r4';
import { ID_RE } from './search';

/**
 * Structural FHIR R4 validation for the gateway's resource types: resourceType,
 * id, required elements, bound code sets, primitive formats and reference
 * shape. Not full profile validation. Diagnostics never echo field values.
 */

type Json = Record<string, unknown>;

const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const DATETIME = /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2}))?)?)?$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const LOCAL_REF = /^[A-Z][A-Za-z]+\/[A-Za-z0-9.-]{1,64}(\/_history\/[A-Za-z0-9.-]{1,64})?$/;
const ABSOLUTE_REF = /^https?:\/\/\S+\/[A-Z][A-Za-z]+\/[A-Za-z0-9.-]{1,64}(\/_history\/[A-Za-z0-9.-]{1,64})?$/;

const CODES = {
  gender: ['male', 'female', 'other', 'unknown'],
  appointmentStatus: [
    'proposed', 'pending', 'booked', 'arrived', 'fulfilled', 'cancelled',
    'noshow', 'entered-in-error', 'checked-in', 'waitlist',
  ],
  participationStatus: ['accepted', 'declined', 'tentative', 'needs-action'],
  encounterStatus: [
    'planned', 'arrived', 'triaged', 'in-progress', 'onleave',
    'finished', 'cancelled', 'entered-in-error', 'unknown',
  ],
  documentReferenceStatus: ['current', 'superseded', 'entered-in-error'],
  compositionStatus: ['preliminary', 'final', 'amended', 'entered-in-error'],
  allergyType: ['allergy', 'intolerance'],
  allergyCategory: ['food', 'medication', 'environment', 'biologic'],
  allergyCriticality: ['low', 'high', 'unable-to-assess'],
  reactionSeverity: ['mild', 'moderate', 'severe'],
  medicationRequestStatus: [
    'active', 'on-hold', 'cancelled', 'completed', 'entered-in-error', 'stopped', 'draft', 'unknown',
  ],
  medicationRequestIntent: [
    'proposal', 'plan', 'order', 'original-order', 'reflex-order', 'filler-order', 'instance-order', 'option',
  ],
  observationStatus: [
    'registered', 'preliminary', 'final', 'amended', 'corrected', 'cancelled', 'entered-in-error', 'unknown',
  ],
};

/** value[x] / onset[x]-style choice elements: at most one variant may be present. */
function choice(c: Checker, obj: Json, prefix: string, path: string): string | undefined {
  const present = Object.keys(obj).filter((k) => k.startsWith(prefix) && /^[A-Z]/.test(k.slice(prefix.length)));
  if (present.length > 1) c.fail('structure', `${path}.${prefix}[x]`, `${path}.${prefix}[x] may only have one type`);
  return present[0];
}

class Checker {
  readonly issues: OperationOutcomeIssue[] = [];

  fail(code: OperationOutcomeIssue['code'], path: string, diagnostics: string): void {
    this.issues.push({ severity: 'error', code, diagnostics, expression: [path] });
  }

  required(obj: Json, key: string, path: string): boolean {
    const v = obj[key];
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) {
      this.fail('required', `${path}.${key}`, `${path}.${key} is required`);
      return false;
    }
    return true;
  }

  array(obj: Json, key: string, path: string): Json[] {
    const v = obj[key];
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      this.fail('structure', `${path}.${key}`, `${path}.${key} must be an array`);
      return [];
    }
    return v.filter((item, i) => {
      if (isObject(item)) return true;
      this.fail('structure', `${path}.${key}[${i}]`, `${path}.${key}[${i}] must be an object`);
      return false;
    });
  }

  object(obj: Json, key: string, path: string): Json | undefined {
    const v = obj[key];
    if (v === undefined) return undefined;
    if (!isObject(v)) {
      this.fail('structure', `${path}.${key}`, `${path}.${key} must be an object`);
      return undefined;
    }
    return v;
  }

  code(obj: Json, key: string, path: string, allowed: string[]): void {
    const v = obj[key];
    if (v !== undefined && (typeof v !== 'string' || !allowed.includes(v))) {
      this.fail('code-invalid', `${path}.${key}`, `${path}.${key} must be one of: ${allowed.join(', ')}`);
    }
  }

  format(obj: Json, key: string, path: string, re: RegExp, kind: string): void {
    const v = obj[key];
    if (v !== undefined && (typeof v !== 'string' || !re.test(v))) {
      this.fail('value', `${path}.${key}`, `${path}.${key} must be a valid FHIR ${kind}`);
    }
  }

  period(obj: Json, key: string, path: string): void {
    const p = this.object(obj, key, path);
    if (!p) return;
    this.format(p, 'start', `${path}.${key}`, DATETIME, 'dateTime');
    this.format(p, 'end', `${path}.${key}`, DATETIME, 'dateTime');
  }
}

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Returns validation issues; empty means valid. */
export function validateResource(resource: unknown, expectedType?: string): OperationOutcomeIssue[] {
  const c = new Checker();
  if (!isObject(resource)) {
    c.fail('structure', 'Resource', 'A resource must be a JSON object');
    return c.issues;
  }
  const type = resource.resourceType;
  if (typeof type !== 'string' || !/^[A-Z][A-Za-z]+$/.test(type)) {
    c.fail('required', 'Resource.resourceType', 'resourceType is required');
    return c.issues;
  }
  if (expectedType !== undefined && type !== expectedType) {
    c.fail('invalid', `${type}.resourceType`, `Expected a ${expectedType} resource`);
    return c.issues;
  }
  if (resource.id !== undefined && (typeof resource.id !== 'string' || !ID_RE.test(resource.id))) {
    c.fail('value', `${type}.id`, `${type}.id must be a valid FHIR id`);
  }
  const meta = c.object(resource, 'meta', type);
  if (meta) {
    if (meta.versionId !== undefined && (typeof meta.versionId !== 'string' || !ID_RE.test(meta.versionId))) {
      c.fail('value', `${type}.meta.versionId`, `${type}.meta.versionId must be a valid FHIR id`);
    }
    c.format(meta, 'lastUpdated', `${type}.meta`, INSTANT, 'instant');
  }

  switch (type) {
    case 'Patient':
      c.code(resource, 'gender', type, CODES.gender);
      c.format(resource, 'birthDate', type, DATE, 'date');
      c.array(resource, 'name', type);
      c.array(resource, 'identifier', type);
      c.array(resource, 'telecom', type);
      break;
    case 'Practitioner':
      c.code(resource, 'gender', type, CODES.gender);
      c.format(resource, 'birthDate', type, DATE, 'date');
      c.array(resource, 'name', type);
      c.array(resource, 'identifier', type);
      break;
    case 'Organization': {
      const ids = c.array(resource, 'identifier', type);
      if (ids.length === 0 && typeof resource.name !== 'string') {
        c.fail('invariant', type, 'org-1: an Organization needs an identifier or a name');
      }
      break;
    }
    case 'Appointment':
      validateAppointment(c, resource);
      break;
    case 'Encounter':
      if (c.required(resource, 'status', type)) c.code(resource, 'status', type, CODES.encounterStatus);
      if (c.required(resource, 'class', type)) c.object(resource, 'class', type);
      c.period(resource, 'period', type);
      c.object(resource, 'subject', type);
      c.array(resource, 'appointment', type);
      c.array(resource, 'participant', type);
      break;
    case 'DocumentReference': {
      if (c.required(resource, 'status', type)) c.code(resource, 'status', type, CODES.documentReferenceStatus);
      if (c.required(resource, 'content', type)) {
        c.array(resource, 'content', type).forEach((content, i) => {
          if (c.required(content, 'attachment', `${type}.content[${i}]`)) {
            c.object(content, 'attachment', `${type}.content[${i}]`);
          }
        });
      }
      c.code(resource, 'docStatus', type, CODES.compositionStatus);
      c.format(resource, 'date', type, INSTANT, 'instant');
      c.array(resource, 'author', type);
      const context = c.object(resource, 'context', type);
      if (context) c.array(context, 'encounter', `${type}.context`);
      break;
    }
    case 'Condition':
      if (c.required(resource, 'subject', type)) c.object(resource, 'subject', type);
      c.object(resource, 'clinicalStatus', type);
      c.object(resource, 'code', type);
      c.format(resource, 'onsetDateTime', type, DATETIME, 'dateTime');
      c.format(resource, 'abatementDateTime', type, DATETIME, 'dateTime');
      c.format(resource, 'recordedDate', type, DATETIME, 'dateTime');
      choice(c, resource, 'onset', type);
      choice(c, resource, 'abatement', type);
      if (resource.abatementDateTime !== undefined || resource.abatementPeriod !== undefined) {
        const status = (resource.clinicalStatus as Json | undefined)?.coding as Json[] | undefined;
        if (status?.some((s) => ['active', 'recurrence', 'relapse'].includes(s.code as string))) {
          c.fail('invariant', type, 'con-4: an abated condition cannot be active, recurrence or relapse');
        }
      }
      break;
    case 'AllergyIntolerance':
      if (c.required(resource, 'patient', type)) c.object(resource, 'patient', type);
      c.code(resource, 'type', type, CODES.allergyType);
      c.code(resource, 'criticality', type, CODES.allergyCriticality);
      if (resource.category !== undefined) {
        if (!Array.isArray(resource.category) || resource.category.some((x) => !CODES.allergyCategory.includes(x as string))) {
          c.fail('code-invalid', `${type}.category`, `${type}.category must be a list of: ${CODES.allergyCategory.join(', ')}`);
        }
      }
      c.format(resource, 'recordedDate', type, DATETIME, 'dateTime');
      c.format(resource, 'onsetDateTime', type, DATETIME, 'dateTime');
      choice(c, resource, 'onset', type);
      c.array(resource, 'reaction', type).forEach((r, i) => {
        const path = `${type}.reaction[${i}]`;
        if (c.required(r, 'manifestation', path)) c.array(r, 'manifestation', path);
        c.code(r, 'severity', path, CODES.reactionSeverity);
      });
      break;
    case 'MedicationRequest':
      if (c.required(resource, 'status', type)) c.code(resource, 'status', type, CODES.medicationRequestStatus);
      if (c.required(resource, 'intent', type)) c.code(resource, 'intent', type, CODES.medicationRequestIntent);
      if (c.required(resource, 'subject', type)) c.object(resource, 'subject', type);
      if (!choice(c, resource, 'medication', type)) {
        c.fail('required', `${type}.medication[x]`, `${type}.medication[x] is required`);
      }
      c.format(resource, 'authoredOn', type, DATETIME, 'dateTime');
      c.array(resource, 'dosageInstruction', type);
      break;
    case 'Observation':
      if (c.required(resource, 'status', type)) c.code(resource, 'status', type, CODES.observationStatus);
      if (c.required(resource, 'code', type)) c.object(resource, 'code', type);
      c.array(resource, 'category', type);
      c.format(resource, 'effectiveDateTime', type, DATETIME, 'dateTime');
      c.format(resource, 'issued', type, INSTANT, 'instant');
      choice(c, resource, 'effective', type);
      choice(c, resource, 'value', type);
      c.array(resource, 'component', type).forEach((comp, i) => {
        const path = `${type}.component[${i}]`;
        if (c.required(comp, 'code', path)) c.object(comp, 'code', path);
        choice(c, comp, 'value', path);
      });
      break;
  }

  checkReferences(c, resource, type);
  return c.issues;
}

function validateAppointment(c: Checker, r: Json): void {
  const t = 'Appointment';
  if (c.required(r, 'status', t)) c.code(r, 'status', t, CODES.appointmentStatus);
  c.format(r, 'start', t, INSTANT, 'instant');
  c.format(r, 'end', t, INSTANT, 'instant');
  if ((r.start === undefined) !== (r.end === undefined)) {
    c.fail('invariant', t, 'app-2: start and end must both be present or both absent');
  }
  if (r.start === undefined && !['proposed', 'cancelled', 'waitlist'].includes(r.status as string)) {
    c.fail('invariant', t, 'app-3: only proposed, cancelled or waitlist appointments may omit start/end');
  }
  if (c.required(r, 'participant', t)) {
    c.array(r, 'participant', t).forEach((p, i) => {
      const path = `${t}.participant[${i}]`;
      if (c.required(p, 'status', path)) c.code(p, 'status', path, CODES.participationStatus);
      if (p.actor === undefined && p.type === undefined) {
        c.fail('invariant', path, 'app-1: a participant needs a type or an actor');
      }
    });
  }
}

/** Every Reference.reference must be literal: "Type/id", an absolute URL, or "#contained". */
function checkReferences(c: Checker, node: unknown, path: string): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => checkReferences(c, item, `${path}[${i}]`));
    return;
  }
  if (!isObject(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'reference' && typeof value === 'string') {
      if (!(value.startsWith('#') || LOCAL_REF.test(value) || ABSOLUTE_REF.test(value))) {
        c.fail('value', `${path}.reference`, `${path}.reference must be a literal reference (Type/id)`);
      }
    } else if (key !== 'contained') {
      checkReferences(c, value, `${path}.${key}`);
    }
  }
}
