import type { FhirResource } from 'fhir/r4';
import type { InScopeType } from '@/lib/fhir/provider';

/**
 * The canonical dataset every provider is tested against. A harness loads it
 * into its backend (Supabase rows, a HAPI server, an adapter's fake EHR) and
 * the contract checks that the same FHIR comes back out.
 *
 * Ids are non-numeric (HAPI requires that for client-assigned ids). Times are
 * mid-day UTC so date-only searches agree in any server timezone.
 */

const MRN = 'https://brevicor.ca/fhir/sid/test-mrn';
const LICENCE = 'https://brevicor.ca/fhir/sid/test-licence';
const ACT_CODE = 'http://terminology.hl7.org/CodeSystem/v3-ActCode';

export const FIXTURES: FhirResource[] = [
  { resourceType: 'Organization', id: 'cf-org-1', name: 'Conformance Clinic', identifier: [{ system: LICENCE, value: 'CF-ORG-1' }] },
  {
    resourceType: 'Practitioner',
    id: 'cf-prac-1',
    name: [{ family: 'Okafor', given: ['Ada'], prefix: ['Dr.'] }],
    identifier: [{ system: LICENCE, value: 'CF-9001' }],
  },
  {
    resourceType: 'Practitioner',
    id: 'cf-prac-2',
    name: [{ family: 'Lavoie', given: ['Luc'] }],
    identifier: [{ system: LICENCE, value: 'CF-9002' }],
  },
  {
    resourceType: 'Patient',
    id: 'cf-pat-1',
    name: [{ family: 'Tremblay', given: ['Amélie'] }],
    identifier: [{ system: MRN, value: 'CF-1001' }],
    gender: 'female',
    birthDate: '1980-05-15',
  },
  {
    resourceType: 'Patient',
    id: 'cf-pat-2',
    name: [{ family: 'Nguyen', given: ['Bao'] }],
    identifier: [{ system: MRN, value: 'CF-1002' }],
    gender: 'male',
    birthDate: '1975-01-02',
  },
  {
    // Only used as the subject of resources the write tests create.
    resourceType: 'Patient',
    id: 'cf-pat-w',
    name: [{ family: 'Writetest', given: ['Wren'] }],
    identifier: [{ system: MRN, value: 'CF-1003' }],
    birthDate: '1990-09-09',
  },
  {
    resourceType: 'Appointment',
    id: 'cf-appt-1',
    status: 'booked',
    start: '2030-01-15T15:00:00Z',
    end: '2030-01-15T15:15:00Z',
    participant: [
      { actor: { reference: 'Patient/cf-pat-1' }, status: 'accepted' },
      { actor: { reference: 'Practitioner/cf-prac-1' }, status: 'accepted' },
    ],
  },
  {
    resourceType: 'Appointment',
    id: 'cf-appt-2',
    status: 'cancelled',
    start: '2030-01-15T17:00:00Z',
    end: '2030-01-15T17:15:00Z',
    participant: [
      { actor: { reference: 'Patient/cf-pat-2' }, status: 'accepted' },
      { actor: { reference: 'Practitioner/cf-prac-1' }, status: 'accepted' },
    ],
  },
  {
    resourceType: 'Appointment',
    id: 'cf-appt-3',
    status: 'booked',
    start: '2030-01-16T15:00:00Z',
    end: '2030-01-16T15:15:00Z',
    participant: [
      { actor: { reference: 'Patient/cf-pat-1' }, status: 'accepted' },
      { actor: { reference: 'Practitioner/cf-prac-2' }, status: 'accepted' },
    ],
  },
  {
    resourceType: 'Encounter',
    id: 'cf-enc-1',
    status: 'finished',
    class: { system: ACT_CODE, code: 'AMB' },
    subject: { reference: 'Patient/cf-pat-1' },
    appointment: [{ reference: 'Appointment/cf-appt-1' }],
    participant: [{ individual: { reference: 'Practitioner/cf-prac-1' } }],
    period: { start: '2030-01-15T15:00:00Z', end: '2030-01-15T15:20:00Z' },
    serviceProvider: { reference: 'Organization/cf-org-1' },
  },
  {
    resourceType: 'Encounter',
    id: 'cf-enc-2',
    status: 'in-progress',
    class: { system: ACT_CODE, code: 'VR' },
    subject: { reference: 'Patient/cf-pat-2' },
    period: { start: '2030-01-16T16:00:00Z' },
  },
  {
    resourceType: 'DocumentReference',
    id: 'cf-doc-1',
    status: 'current',
    subject: { reference: 'Patient/cf-pat-1' },
    context: { encounter: [{ reference: 'Encounter/cf-enc-1' }] },
    content: [{ attachment: { contentType: 'text/plain', data: 'c3ludGhldGljIG5vdGU=' } }],
  },
];

/** Search params the app relies on. Every provider must declare and honour these. */
export const REQUIRED_SEARCH_PARAMS: Record<Exclude<InScopeType, 'Organization'>, string[]> = {
  Patient: ['_id', 'family', 'given', 'birthdate', 'identifier'],
  Practitioner: ['_id', 'family', 'identifier'],
  Appointment: ['patient', 'practitioner', 'actor', 'date', 'status'],
  Encounter: ['patient', 'subject', 'appointment', 'date'],
  DocumentReference: ['patient', 'subject', 'encounter'],
};

/** [query, expected ids]. Covers every required param at least once. */
export const SEARCH_CASES: [string, string[]][] = [
  ['Patient?_id=cf-pat-1', ['cf-pat-1']],
  ['Patient?family=tremb', ['cf-pat-1']],
  ['Patient?family=TREMBLAY', ['cf-pat-1']],
  ['Patient?family=tremblay,nguyen', ['cf-pat-1', 'cf-pat-2']],
  ['Patient?given=amelie', ['cf-pat-1']],
  ['Patient?family=tremblay,nguyen&given=bao', ['cf-pat-2']],
  ['Patient?birthdate=1980-05-15', ['cf-pat-1']],
  ['Patient?birthdate=lt1979-01-01&family=tremblay,nguyen', ['cf-pat-2']],
  ['Patient?identifier=CF-1001', ['cf-pat-1']],
  [`Patient?identifier=${encodeURIComponent(`${MRN}|CF-1002`)}`, ['cf-pat-2']],
  ['Practitioner?_id=cf-prac-2', ['cf-prac-2']],
  ['Practitioner?family=okaf', ['cf-prac-1']],
  ['Practitioner?identifier=CF-9002', ['cf-prac-2']],
  ['Appointment?patient=Patient/cf-pat-1', ['cf-appt-1', 'cf-appt-3']],
  ['Appointment?patient=cf-pat-2', ['cf-appt-2']],
  ['Appointment?practitioner=cf-prac-1', ['cf-appt-1', 'cf-appt-2']],
  ['Appointment?actor=Practitioner/cf-prac-2', ['cf-appt-3']],
  ['Appointment?date=2030-01-15', ['cf-appt-1', 'cf-appt-2']],
  ['Appointment?date=ge2030-01-15&date=lt2030-01-16', ['cf-appt-1', 'cf-appt-2']],
  ['Appointment?date=gt2030-01-15', ['cf-appt-3']],
  ['Appointment?date=ge2030-01-15&date=le2030-01-15', ['cf-appt-1', 'cf-appt-2']],
  ['Appointment?date=le2030-01-15&practitioner=cf-prac-1', ['cf-appt-1', 'cf-appt-2']],
  ['Appointment?status=cancelled', ['cf-appt-2']],
  ['Appointment?status=booked&practitioner=cf-prac-1', ['cf-appt-1']],
  ['Encounter?patient=cf-pat-1', ['cf-enc-1']],
  ['Encounter?subject=Patient/cf-pat-2', ['cf-enc-2']],
  ['Encounter?appointment=cf-appt-1', ['cf-enc-1']],
  ['Encounter?date=2030-01-15', ['cf-enc-1']],
  ['Encounter?date=ge2030-01-16&subject=Patient/cf-pat-2', ['cf-enc-2']],
  ['DocumentReference?patient=cf-pat-1', ['cf-doc-1']],
  ['DocumentReference?subject=Patient/cf-pat-1', ['cf-doc-1']],
  ['DocumentReference?encounter=cf-enc-1', ['cf-doc-1']],
];
