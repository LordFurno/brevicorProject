import 'server-only';
import type { Appointment, CapabilityStatement, Patient, Practitioner } from 'fhir/r4';
import { gatewayCreate, gatewayRead, gatewaySearch, serviceContext } from '@/lib/clinical/gateway';
import { patientName } from '@/lib/clinical/map';
import { adminClient } from '@/lib/supabase/admin';
import type { PublicClinic } from '@/lib/directory';
import { addDays, daysInMonth, pad, ymdInTz, zonedDate } from '@/lib/time';
import { validateBookingInput } from './booking-demo';
import { getVisitStore } from './store';
import { syncVisits } from './sync';
import { appointmentVisitId } from './tokens';

/**
 * Self-service booking into the clinic's EHR, through the FHIR gateway (demo):
 * a new patient with no account picks a physician and a time, and the booking
 * creates a FHIR Patient and Appointment, then the visit and its invitation.
 * The patient continues with the normal /visit/<token> flow.
 *
 * Enabled with EHR_BOOKING_ENABLED=true for clinics in EHR_BOOKING_CLINICS
 * (default demo-mock) whose EHR supports creating Patient and Appointment.
 */

const MODALITY = 'https://brevicor.ca/fhir/CodeSystem/consultation-modality';
const SELF_BOOKING_SYSTEM = 'https://brevicor.ca/fhir/sid/self-booking';
const ONTARIO_HCN = 'https://fhir.infoway-inforoute.ca/NamingSystem/ca-on-patient-hcn';
const VERSION_EXT = 'http://hl7.org/fhir/ca/baseline/StructureDefinition/ext-identifierversion';
const COLORS = ['#1c7e69', '#4f46e5', '#b45309', '#0369a1', '#be185d'];

/** Demo schedule: every 15 minutes, all day, up to 14 days ahead (inside the visit sync window). */
export const EHR_SLOT_MIN = 15;
const HORIZON_DAYS = 14;
/** A slot that started up to 10 minutes ago can still be booked, so the demo can join at once. */
const STARTED_SLOT_MIN = 10;

const clinicIds = () =>
  (process.env.EHR_BOOKING_CLINICS ?? 'demo-mock')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Public practitioner ids carry the clinic: "<clinicId>:<FHIR Practitioner id>". */
function parsePractitionerId(id: string) {
  const [clinicId, practitionerId] = id.split(':');
  if (!clinicIds().includes(clinicId) || !/^[A-Za-z0-9.-]{1,64}$/.test(practitionerId ?? '')) return null;
  return { clinicId, practitionerId, ref: `Practitioner/${practitionerId}` };
}

async function canBook(clinicId: string) {
  const statement = await gatewayRead<CapabilityStatement>('metadata', serviceContext(clinicId));
  const resources = statement.rest?.find((r) => r.mode === 'server')?.resource ?? [];
  const creates = (type: string) => !!resources.find((r) => r.type === type)?.interaction?.some((i) => i.code === 'create');
  return creates('Patient') && creates('Appointment');
}

/** Clinics and physicians a patient can book with (no emails or internal ids beyond FHIR ids). */
export async function ehrDirectory(): Promise<PublicClinic[]> {
  const out: PublicClinic[] = [];
  for (const clinicId of clinicIds()) {
    if (!(await canBook(clinicId).catch(() => false))) continue;
    const db = adminClient();
    const { data: clinic } = await db.from('ehr_connections').select('name,display_name').eq('clinic_id', clinicId).single();
    const { data: members } = await db.from('clinic_members').select('practitioner_ref').eq('clinic_id', clinicId).eq('role', 'physician');
    const refs = [...new Set((members ?? []).map((m) => m.practitioner_ref as string).filter(Boolean))];
    const practitioners = await Promise.all(
      refs.map(async (ref, i) => {
        const p = await gatewayRead<Practitioner>(ref, serviceContext(clinicId)).catch(() => null);
        const name = p ? patientName(p as unknown as Patient).replace(/^Dr\.?\s+/, '') : 'Physician';
        return {
          id: `${clinicId}:${ref.slice('Practitioner/'.length)}`,
          name,
          specialty: 'Family Medicine',
          bio: 'Virtual visits by video.',
          color: COLORS[i % COLORS.length],
          languages: ['English'],
          slotMinutes: EHR_SLOT_MIN,
        };
      }),
    );
    out.push({
      id: clinicId,
      name: (clinic?.display_name as string | null) ?? (clinic?.name as string) ?? clinicId,
      city: 'Ontario',
      address: 'Virtual care',
      phone: '',
      practitioners,
    });
  }
  return out;
}

const earliest = (now: number) => now - STARTED_SLOT_MIN * 60_000;
const onGrid = (d: Date) => d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0 && d.getUTCMinutes() % EHR_SLOT_MIN === 0;

/** Starts already taken in the EHR for this practitioner between two instants. */
async function takenStarts(clinicId: string, practitionerRef: string, from: Date, to: Date) {
  const appointments = await gatewaySearch<Appointment>(
    `Appointment?practitioner=${encodeURIComponent(practitionerRef)}&date=ge${from.toISOString().slice(0, 10)}&date=le${to.toISOString().slice(0, 10)}&_count=100`,
    serviceContext(clinicId),
  );
  return new Set(
    appointments
      .filter((a) => a.start && !['cancelled', 'entered-in-error', 'noshow'].includes(a.status))
      .map((a) => new Date(a.start!).toISOString()),
  );
}

export async function ehrAvailability(publicId: string, month: string, now = Date.now()) {
  const p = parsePractitionerId(publicId);
  if (!p) return null;
  const today = ymdInTz(now);
  const horizon = addDays(today, HORIZON_DAYS);
  const first = `${month}-01`;
  const last = `${month}-${pad(daysInMonth(month))}`;
  if (last < today || first > horizon) return {};
  const taken = await takenStarts(p.clinicId, p.ref, zonedDate(first, 0), zonedDate(addDays(last, 1), 0));
  const days: Record<string, string[]> = {};
  for (let d = 1; d <= daysInMonth(month); d++) {
    const ymd = `${month}-${pad(d)}`;
    if (ymd < today || ymd > horizon) continue;
    const slots: string[] = [];
    for (let t = 0; t < 24 * 60; t += EHR_SLOT_MIN) {
      const start = zonedDate(ymd, t);
      if (start.getTime() < earliest(now) || !onGrid(start)) continue;
      if (!taken.has(start.toISOString())) slots.push(start.toISOString());
    }
    if (slots.length) days[ymd] = slots;
  }
  return days;
}

type Result = { ok: true; token: string; visitId: string } | { ok: false; status: number; error: string };

function hcnIdentifier(raw: string) {
  const digits = raw.replace(/\D/g, '');
  const version = raw.replace(/[^A-Z]/g, '').slice(0, 2);
  if (digits.length !== 10) return [];
  return [
    {
      ...(version ? { extension: [{ url: VERSION_EXT, valueString: version }] } : {}),
      use: 'official' as const,
      type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'JHN' }], text: 'Ontario health card number' },
      system: ONTARIO_HCN,
      value: digits,
    },
  ];
}

export async function createEhrBooking(body: unknown, now = Date.now()): Promise<Result> {
  const b = (body ?? {}) as Record<string, unknown>;
  const p = parsePractitionerId(typeof b.practitionerId === 'string' ? b.practitionerId : '');
  if (!p) return { ok: false, status: 400, error: 'Please choose a physician.' };
  const input = validateBookingInput(b, now);
  if (!input.ok) return input;
  const { name, dateOfBirth, email, phone, healthCard, reason } = input.value;

  const start = new Date(typeof b.start === 'string' ? b.start : '');
  if (Number.isNaN(start.getTime()) || !onGrid(start) || start.getTime() < earliest(now) || ymdInTz(start) > addDays(ymdInTz(now), HORIZON_DAYS))
    return { ok: false, status: 400, error: 'That time isn’t available. Please pick another.' };
  const end = new Date(start.getTime() + EHR_SLOT_MIN * 60_000);
  if ((await takenStarts(p.clinicId, p.ref, start, start)).has(start.toISOString()))
    return { ok: false, status: 409, error: 'Someone just booked that time. Please choose another.' };

  const ctx = serviceContext(p.clinicId);
  const parts = name.split(' ');
  const { resource: patient } = await gatewayCreate<Patient>(
    {
      resourceType: 'Patient',
      identifier: [{ system: SELF_BOOKING_SYSTEM, value: crypto.randomUUID() }, ...hcnIdentifier(healthCard)],
      name: [{ use: 'official', family: parts.length > 1 ? parts.at(-1) : parts[0], given: parts.length > 1 ? parts.slice(0, -1) : undefined }],
      birthDate: dateOfBirth,
      telecom: [
        ...(phone ? [{ system: 'phone' as const, value: phone, use: 'mobile' as const }] : []),
        ...(email ? [{ system: 'email' as const, value: email }] : []),
      ],
    },
    ctx,
  );
  const instant = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const { resource: appointment } = await gatewayCreate<Appointment>(
    {
      resourceType: 'Appointment',
      status: 'booked',
      serviceType: [{ coding: [{ system: MODALITY, code: 'video', display: 'Video consultation' }], text: 'Video consultation' }],
      appointmentType: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0276', code: 'ROUTINE' }] },
      reasonCode: [{ text: reason }],
      start: instant(start),
      end: instant(end),
      minutesDuration: EHR_SLOT_MIN,
      created: ymdInTz(now),
      participant: [
        { actor: { reference: `Patient/${patient.id}` }, required: 'required', status: 'accepted' },
        { actor: { reference: p.ref }, required: 'required', status: 'accepted' },
      ],
    },
    ctx,
  );

  // The visit and its invitation (sent to the contacts the patient entered, via the
  // notification service), keeping the same token for the confirmation page.
  const appointmentRef = `Appointment/${appointment.id}`;
  let token: string | undefined;
  const day = ymdInTz(start);
  await syncVisits(p.clinicId, { from: day, to: addDays(day, 1) }, {
    onInvited: (ref, t) => {
      if (ref === appointmentRef) token = t;
    },
  });
  const visitId = appointmentVisitId(p.clinicId, appointmentRef);
  if (!token || !(await getVisitStore().get(p.clinicId, visitId)))
    return { ok: false, status: 503, error: 'Your appointment was booked, but the visit link isn’t ready. Please call the clinic.' };
  return { ok: true, token, visitId };
}

/** What the confirmation page shows for an EHR booking. */
export async function ehrConfirmation(token: string) {
  const visit = await getVisitStore().getByToken(token);
  if (!visit) return null;
  const ctx = serviceContext(visit.clinicId);
  const [patient, practitioner] = await Promise.all([
    gatewayRead<Patient>(visit.patientRef, ctx),
    gatewayRead<Practitioner>(visit.practitionerRef, ctx).catch(() => null),
  ]);
  const { data: clinic } = await adminClient().from('ehr_connections').select('name,display_name').eq('clinic_id', visit.clinicId).single();
  const official = patient.name?.find((n) => n.use === 'official') ?? patient.name?.[0];
  return {
    visitId: visit.id,
    start: visit.start,
    end: visit.end,
    firstName: official?.given?.[0] ?? official?.family ?? 'there',
    practitioner: {
      name: practitioner ? patientName(practitioner as unknown as Patient).replace(/^Dr\.?\s+/, '') : 'your physician',
      specialty: 'Family Medicine',
      color: COLORS[0],
    },
    clinicName: (clinic?.display_name as string | null) ?? (clinic?.name as string) ?? visit.clinicId,
    path: `/visit/${token}`,
  };
}
