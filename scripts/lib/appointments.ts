import type { SupabaseClient } from '@supabase/supabase-js';
import type { Appointment } from 'fhir/r4';
import { FHIR_RESOURCES_TABLE } from '@/lib/fhir/providers/mock';
import { toRow } from '@/lib/fhir/providers/mock-index';
import { MODALITY_SYSTEM } from '@/lib/fhir/modality';
import { formatInstant, formatLocal } from '@/lib/fhir/providers/adapter/helpers';
import { dateRange, defaultTimeZone } from '@/lib/fhir/search';
import { CLINICSOFT_SCHEMA, withPractice, type ClinicSoftAppointment } from '@/lib/vendors/clinicsoft/rows';
import { deleteResources, fail, upsertRows } from './cli';
import { clinicSoftLoaded, insertAll } from './clinicsoft';
import { applyDemoContacts, pickDemoContacts } from './demo-contacts';

export { MODALITY_SYSTEM };
const APPOINTMENT_TYPE_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v2-0276';

const TODAY_SLOTS = ['09:00', '09:30', '10:00', '10:30', '11:00', '13:00', '14:00', '15:00'];
const TOMORROW_SLOTS = ['09:00', '09:45', '10:30', '11:15', '12:00', '13:00', '13:45', '14:30', '15:15', '16:00'];
/** Minutes from now, for waiting-room demos (patients may join 15 minutes early). */
const SOON_OFFSETS = [10, 30];
const CANCELLED = new Set([3, 12, 17]);
const DURATION_MIN = 15;
const REASONS = ['Medication review', 'Follow-up visit', 'Test results review', 'New concern', 'Prescription renewal', 'Chronic care check-in'];

/** One appointment, independent of how any EHR stores it. */
export interface PlannedAppointment {
  id: string;
  patientId: string;
  practitionerId: string;
  start: Date;
  durationMin: number;
  status: 'booked' | 'cancelled';
  modality: 'video' | 'telephone';
  followUp: boolean;
  reason: string;
}

export interface PlanInput {
  now: Date;
  patientIds: string[];
  practitionerIds: string[];
  timeZone?: string;
}

/** ~20 appointments today and tomorrow (clinic-local), relative to `now`. Same day + same patients = same plan. */
export function planAppointments({ now, patientIds, practitionerIds, timeZone = defaultTimeZone() }: PlanInput): PlannedAppointment[] {
  if (patientIds.length === 0 || practitionerIds.length === 0) throw new Error('need at least one patient and one practitioner');
  const today = localDate(now, timeZone);
  const tomorrow = addDays(today, 1);
  const at = (date: string, hhmm: string) => dateRange(`${date}T${hhmm}`, timeZone)!.lo;

  const soon = SOON_OFFSETS.map((m) => roundUpTo5(new Date(now.getTime() + m * 60_000)));
  const starts = [
    ...TODAY_SLOTS.map((s) => at(today, s)),
    ...soon,
    ...TOMORROW_SLOTS.map((s) => at(tomorrow, s)),
  ].sort((a, b) => a.getTime() - b.getTime());

  const random = mulberry32(hash(today));
  const patients = shuffle(patientIds, random);
  const stamp = today.replaceAll('-', '');
  const soonTimes = new Set(soon.map((d) => d.getTime()));

  return starts.map((start, i) => ({
    id: `appt-${stamp}-${String(i + 1).padStart(2, '0')}`,
    patientId: patients[i % patients.length],
    practitionerId: practitionerIds[i % practitionerIds.length],
    start,
    durationMin: DURATION_MIN,
    status: CANCELLED.has(i) && !soonTimes.has(start.getTime()) ? 'cancelled' : 'booked',
    modality: i % 3 === 2 ? 'telephone' : 'video',
    followUp: i % 4 === 1,
    reason: REASONS[i % REASONS.length],
  }));
}

/** The plan as demo-mock stores it (FHIR). */
export function toFhirAppointment(p: PlannedAppointment, now: Date): Appointment {
  const modality = p.modality === 'telephone' ? 'Telephone consultation' : 'Video consultation';
  return {
    resourceType: 'Appointment',
    id: p.id,
    status: p.status,
    ...(p.status === 'cancelled' ? { cancelationReason: { text: 'Cancelled by patient' } } : {}),
    appointmentType: {
      coding: [
        p.followUp
          ? { system: APPOINTMENT_TYPE_SYSTEM, code: 'FOLLOWUP', display: 'A follow up visit from a previous appointment' }
          : { system: APPOINTMENT_TYPE_SYSTEM, code: 'ROUTINE', display: 'Routine appointment - default if not valued' },
      ],
    },
    serviceType: [{ coding: [{ system: MODALITY_SYSTEM, code: p.modality, display: modality }], text: modality }],
    reasonCode: [{ text: p.reason }],
    start: formatInstant(p.start),
    end: formatInstant(new Date(p.start.getTime() + p.durationMin * 60_000)),
    minutesDuration: p.durationMin,
    created: formatInstant(now),
    participant: [
      { actor: { reference: `Patient/${p.patientId}` }, required: 'required', status: 'accepted' },
      { actor: { reference: `Practitioner/${p.practitionerId}` }, required: 'required', status: 'accepted' },
    ],
  };
}

/** The plan as ClinicSoft stores it: local date + HH:MM, minutes, letter codes. */
export function toClinicSoftAppointment(p: PlannedAppointment, timeZone = defaultTimeZone()): ClinicSoftAppointment {
  return {
    apptId: p.id,
    patientNo: p.patientId,
    providerNo: p.practitionerId,
    apptDate: formatLocal(p.start.toISOString(), timeZone, 'YYYY-MM-DD')!,
    startTime: formatLocal(p.start.toISOString(), timeZone, 'HH:mm')!,
    duration: p.durationMin,
    status: p.status === 'cancelled' ? 'C' : 'B',
    type: p.modality === 'telephone' ? 'VIRT_PHONE' : 'VIRT_VIDEO',
    reason: p.reason,
  };
}

/** Convenience for callers that only want FHIR. */
export function buildAppointments(input: PlanInput): Appointment[] {
  return planAppointments(input).map((p) => toFhirAppointment(p, input.now));
}

export interface SeedResult {
  plan: PlannedAppointment[];
  appointments: Appointment[];
  /** Practice written to, or null if ClinicSoft wasn't loaded. */
  clinicSoftPractice: string | null;
  /** Patients given DEMO_PHONE_NUMBERS / DEMO_EMAILS. */
  demoContacts: number;
}

/**
 * Replaces a FHIR clinic's Appointments with a fresh plan around now, writes
 * the same plan to the ClinicSoft practice (if loaded), and gives the first
 * patients seen today DEMO_PHONE_NUMBERS / DEMO_EMAILS (every other phone and
 * email is cleared).
 */
export async function seedAppointments(
  db: SupabaseClient,
  clinicId: string,
  opts: { now?: Date; clinicSoftPractice?: string; demoPhones?: string[]; demoEmails?: string[] } = {},
): Promise<SeedResult> {
  const now = opts.now ?? new Date();
  const patientRows = await selectAll(db, clinicId, 'Patient', 'id, deceasedDateTime:resource->deceasedDateTime, deceasedBoolean:resource->deceasedBoolean');
  const living = patientRows.filter((r) => !r.deceasedDateTime && r.deceasedBoolean !== true).map((r) => r.id as string);
  const practitioners = (await selectAll(db, clinicId, 'Practitioner', 'id')).map((r) => r.id as string).slice(0, 3);
  if (living.length === 0 || practitioners.length === 0) {
    fail(`clinic '${clinicId}' needs living patients and practitioners: run the Synthea import first`);
  }

  const plan = planAppointments({ now, patientIds: living, practitionerIds: practitioners });
  const appointments = plan.map((p) => toFhirAppointment(p, now));
  await deleteResources(db, clinicId, 'Appointment');
  await upsertRows(db, appointments.map((a) => toRow(clinicId, a, 1, now)));

  let practice: string | null = null;
  if (opts.clinicSoftPractice && (await clinicSoftLoaded(db, opts.clinicSoftPractice))) {
    practice = opts.clinicSoftPractice;
    const { error } = await db.schema(CLINICSOFT_SCHEMA).from('schedule').delete().eq('practice_id', practice);
    if (error) fail(`clearing clinicsoft.schedule failed (${error.code})`);
    await insertAll(db, 'schedule', plan.map((p) => withPractice(practice!, toClinicSoftAppointment(p))));
  }

  const contacts = pickDemoContacts(plan, opts.demoPhones ?? [], opts.demoEmails ?? [], now);
  await applyDemoContacts(db, contacts, { fhirClinic: clinicId, clinicSoftPractice: practice, now });
  return { plan, appointments, clinicSoftPractice: practice, demoContacts: contacts.size };
}

async function selectAll(db: SupabaseClient, clinicId: string, type: string, columns: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from(FHIR_RESOURCES_TABLE)
      .select(columns)
      .eq('clinic_id', clinicId)
      .eq('resource_type', type)
      .order('id')
      .range(from, from + 999);
    if (error) fail(`reading ${type} failed (${error.code})`);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

/** YYYY-MM-DD of `instant` in `timeZone`. */
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function roundUpTo5(d: Date): Date {
  const step = 5 * 60_000;
  return new Date(Math.ceil(d.getTime() / step) * step);
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Small seeded PRNG so a day's schedule is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
