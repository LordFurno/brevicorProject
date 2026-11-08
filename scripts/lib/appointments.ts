import type { SupabaseClient } from '@supabase/supabase-js';
import type { Appointment } from 'fhir/r4';
import { FHIR_RESOURCES_TABLE } from '@/lib/fhir/providers/mock';
import { toRow } from '@/lib/fhir/providers/mock-index';
import { dateRange, defaultTimeZone } from '@/lib/fhir/search';
import { deleteResources, fail, upsertRows } from './cli';

/** How the app tells video from telephone consultations. Documented in docs/fhir-contract.md. */
export const MODALITY_SYSTEM = 'https://brevicor.ca/fhir/CodeSystem/consultation-modality';
const APPOINTMENT_TYPE_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v2-0276';

const TODAY_SLOTS = ['09:00', '09:30', '10:00', '10:30', '11:00', '13:00', '14:00', '15:00'];
const TOMORROW_SLOTS = ['09:00', '09:45', '10:30', '11:15', '12:00', '13:00', '13:45', '14:30', '15:15', '16:00'];
/** Minutes from now, for waiting-room demos (patients may join 15 minutes early). */
const SOON_OFFSETS = [10, 30];
const CANCELLED = new Set([3, 12, 17]);
const DURATION_MIN = 15;

export interface AppointmentPlan {
  now: Date;
  patientIds: string[];
  practitionerIds: string[];
  timeZone?: string;
}

/** ~20 appointments today and tomorrow (clinic-local), relative to `now`. */
export function buildAppointments({ now, patientIds, practitionerIds, timeZone = defaultTimeZone() }: AppointmentPlan): Appointment[] {
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

  return starts.map((start, i) => {
    const cancelled = CANCELLED.has(i) && !soonTimes.has(start.getTime());
    const telephone = i % 3 === 2;
    const modality = telephone
      ? { code: 'telephone', display: 'Telephone consultation' }
      : { code: 'video', display: 'Video consultation' };
    const followUp = i % 4 === 1;
    return {
      resourceType: 'Appointment',
      id: `appt-${stamp}-${String(i + 1).padStart(2, '0')}`,
      status: cancelled ? 'cancelled' : 'booked',
      ...(cancelled ? { cancelationReason: { text: 'Cancelled by patient' } } : {}),
      appointmentType: {
        coding: [
          followUp
            ? { system: APPOINTMENT_TYPE_SYSTEM, code: 'FOLLOWUP', display: 'A follow up visit from a previous appointment' }
            : { system: APPOINTMENT_TYPE_SYSTEM, code: 'ROUTINE', display: 'Routine appointment - default if not valued' },
        ],
      },
      serviceType: [{ coding: [{ system: MODALITY_SYSTEM, ...modality }], text: modality.display }],
      start: start.toISOString(),
      end: new Date(start.getTime() + DURATION_MIN * 60_000).toISOString(),
      minutesDuration: DURATION_MIN,
      created: now.toISOString(),
      participant: [
        { actor: { reference: `Patient/${patients[i % patients.length]}` }, required: 'required', status: 'accepted' },
        { actor: { reference: `Practitioner/${practitionerIds[i % practitionerIds.length]}` }, required: 'required', status: 'accepted' },
      ],
    };
  });
}

/** Replaces the clinic's Appointments with a fresh set around now. */
export async function seedAppointments(db: SupabaseClient, clinicId: string, now = new Date()): Promise<Appointment[]> {
  const patientRows = await selectAll(db, clinicId, 'Patient', 'id, deceasedDateTime:resource->deceasedDateTime, deceasedBoolean:resource->deceasedBoolean');
  const living = patientRows.filter((r) => !r.deceasedDateTime && r.deceasedBoolean !== true).map((r) => r.id as string);
  const practitioners = (await selectAll(db, clinicId, 'Practitioner', 'id')).map((r) => r.id as string).slice(0, 3);
  if (living.length === 0 || practitioners.length === 0) {
    fail(`clinic '${clinicId}' needs living patients and practitioners: run the Synthea import first`);
  }

  const appointments = buildAppointments({ now, patientIds: living, practitionerIds: practitioners });
  await deleteResources(db, clinicId, 'Appointment');
  await upsertRows(db, appointments.map((a) => toRow(clinicId, a, 1, now)));
  return appointments;
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
