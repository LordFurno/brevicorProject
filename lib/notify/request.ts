import { FhirError } from '@/lib/fhir/outcome';
import { allowedLink } from './config';
import type { EventInput } from './service';
import { NOTIFICATION_TYPES, type NotificationType } from './types';

/** Body of POST /api/notify/v1/events. Strict: unknown fields (a phone number, say) are rejected, not ignored. */

const DEDUPE_KEY_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const REFS = { practitionerRef: 'Practitioner', patientRef: 'Patient', appointmentRef: 'Appointment' } as const;
const FIELDS = new Set(['type', 'dedupeKey', 'link', ...Object.keys(REFS)]);

export function parseEvent(body: unknown, appBaseUrl: string): EventInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('value', 'The request body must be a JSON object');
  const b = body as Record<string, unknown>;

  const unknown = Object.keys(b).filter((k) => !FIELDS.has(k));
  if (unknown.length > 0) {
    const names = unknown.every((k) => /^[A-Za-z0-9_]{1,40}$/.test(k)) ? `: ${unknown.join(', ')}` : '';
    throw invalid('value', `Unknown field(s)${names}. Contact details are never accepted; they come from the FHIR Patient.`);
  }

  const type = b.type;
  if (typeof type !== 'string' || !(NOTIFICATION_TYPES as readonly string[]).includes(type)) {
    throw invalid('value', `type must be one of: ${NOTIFICATION_TYPES.join(', ')}`);
  }
  if (typeof b.dedupeKey !== 'string' || !DEDUPE_KEY_RE.test(b.dedupeKey)) {
    throw invalid('value', 'dedupeKey must be 1-128 characters: letters, digits and . _ : -');
  }
  const input: EventInput = { type: type as NotificationType, dedupeKey: b.dedupeKey };

  for (const [field, resourceType] of Object.entries(REFS) as [keyof typeof REFS, string][]) {
    const value = b[field];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !new RegExp(`^${resourceType}/[A-Za-z0-9.-]{1,64}$`).test(value)) {
      throw invalid('value', `${field} must be a relative reference like ${resourceType}/123`);
    }
    input[field] = value;
  }

  if (b.link !== undefined) {
    const link = typeof b.link === 'string' ? allowedLink(b.link, appBaseUrl) : null;
    if (!link) throw invalid('value', 'link must be an absolute URL under APP_BASE_URL');
    input.link = link;
  } else if (input.type !== 'visit_cancelled') {
    throw invalid('required', `link is required for ${input.type}`);
  }

  if (input.type === 'patient_waiting' && !input.practitionerRef && !input.appointmentRef) {
    throw invalid('required', 'patient_waiting needs practitionerRef or appointmentRef');
  }
  if (input.type !== 'patient_waiting' && !input.appointmentRef) throw invalid('required', `${input.type} needs appointmentRef`);
  return input;
}

function invalid(code: 'value' | 'required', message: string): FhirError {
  return new FhirError(400, code, message);
}
