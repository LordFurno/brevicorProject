import { normalizeString } from '@/lib/fhir/search';

/**
 * Row shapes of the fake ClinicSoft database (schema `clinicsoft`). The
 * vendor-facing columns are what its API returns; `search_*` and `dob_date`
 * are its internal search helpers, derived here so every writer fills them
 * the same way.
 */

export const CLINICSOFT_SCHEMA = 'clinicsoft';

export interface ClinicSoftPatient {
  patientNo: string;
  chartNo: string | null;
  title: string | null;
  lastName: string;
  firstName: string | null;
  middleName: string | null;
  suffix: string | null;
  dob: string | null; // DD/MM/YYYY
  sex: 'M' | 'F' | 'U' | null;
  cellPhone: string | null;
  homePhone: string | null;
  email: string | null;
  address1: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  deceasedDate: string | null; // DD/MM/YYYY
}

export interface ClinicSoftProvider {
  providerNo: string;
  title: string | null;
  firstName: string | null;
  lastName: string;
  sex: 'M' | 'F' | 'U' | null;
  specialty: string | null;
  cpsoNo: string | null;
  orgId: string | null;
}

export interface ClinicSoftOrganization {
  orgId: string;
  orgName: string;
  licenceNo: string | null;
  phone: string | null;
  address1: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
}

export type ScheduleStatus = 'B' | 'C' | 'N' | 'A';
export type ScheduleType = 'VIRT_VIDEO' | 'VIRT_PHONE';

export interface ClinicSoftAppointment {
  apptId: string;
  patientNo: string;
  providerNo: string;
  apptDate: string; // local YYYY-MM-DD
  startTime: string; // local HH:MM
  duration: number; // minutes
  status: ScheduleStatus;
  type: ScheduleType;
  reason: string | null;
}

export interface ClinicSoftEncounter {
  encounterNo: string;
  patientNo: string;
  providerNo: string | null;
  orgId: string | null;
  apptId: string | null;
  startDateTime: string; // local YYYY-MM-DD HH:MM:SS
  endDateTime: string | null;
  encClass: string;
  encStatus: 'OPEN' | 'CLOSED' | 'VOID';
  encTypeCode: string | null;
  encTypeDesc: string | null;
}

export interface ClinicSoftDocument {
  docId: string;
  patientNo: string;
  encounterNo: string | null;
  docType: string | null;
  mimeType: string;
  createdAt: string | null; // local YYYY-MM-DD HH:MM:SS
  body: string; // base64
}

type WithPractice<T> = T & { practice_id: string };

export function patientRow(practiceId: string, p: ClinicSoftPatient) {
  return {
    practice_id: practiceId,
    ...p,
    search_last: normalizeString(p.lastName),
    search_first: normalizeString(p.firstName ?? ''),
    dob_date: p.dob ? ddmmyyyyToIso(p.dob) : null,
  };
}

export function providerRow(practiceId: string, p: ClinicSoftProvider) {
  return { practice_id: practiceId, ...p, search_last: normalizeString(p.lastName) };
}

export function withPractice<T extends object>(practiceId: string, row: T): WithPractice<T> {
  return { practice_id: practiceId, ...row };
}

/** 'DD/MM/YYYY' -> 'YYYY-MM-DD' */
export function ddmmyyyyToIso(value: string): string {
  const [d, m, y] = value.split('/');
  return `${y}-${m}-${d}`;
}

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY' */
export function isoToDdmmyyyy(value: string): string {
  const [y, m, d] = value.split('-');
  return `${d}/${m}/${y}`;
}
