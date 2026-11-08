import { randomBytes } from 'crypto';
import { DEMO_BOOK_STARTED_SLOT_MIN, DEMO_HOURS, DEMO_WORK_DAYS, isDemoEnvironment } from '@/lib/demo';
import { getPractitioner, type Practitioner } from '@/lib/directory';
import { addDays, daysInMonth, minutesInTz, pad, weekday, ymdInTz, zonedDate } from '@/lib/time';
import { getVisitStore, type VisitStore } from './store';
import {
  BOOKING_HORIZON_DAYS,
  BOOKING_LEAD_MIN,
  EARLY_ENTRY_MIN,
  LATE_ENTRY_MIN,
  PRESENCE_TIMEOUT_MS,
  type DoctorVisitView,
  type PatientStatus,
  type Visit,
  type VisitPatient,
} from './types';

const iso = (ms: number) => new Date(ms).toISOString();
const LUNCH = { start: 12 * 60, end: 13 * 60 };

/** The schedule actually offered to patients (demo mode widens it for testing). */
function schedule(p: Practitioner): Practitioner {
  return isDemoEnvironment() ? { ...p, workDays: DEMO_WORK_DAYS, hours: DEMO_HOURS } : p;
}

/** Earliest bookable start time. */
function earliestStart(now: number) {
  return isDemoEnvironment() ? now - DEMO_BOOK_STARTED_SLOT_MIN * 60_000 : now + BOOKING_LEAD_MIN * 60_000;
}

// ── Presence / views ───────────────────────────────────────────────

export function isPresent(v: Visit, now = Date.now()) {
  if (v.status !== 'waiting') return false;
  if (v.simulated) return true;
  return !!v.lastSeenAt && now - Date.parse(v.lastSeenAt) < PRESENCE_TIMEOUT_MS;
}

export function toDoctorView(v: Visit, now = Date.now()): DoctorVisitView {
  return {
    id: v.id,
    start: v.start,
    end: v.end,
    status: v.status,
    present: isPresent(v, now),
    waitingSince: v.waitingSince,
    admittedAt: v.admittedAt,
    endedAt: v.endedAt,
    patientName: v.patient.name,
    patientDateOfBirth: v.patient.dateOfBirth,
    reason: v.reason,
    invitationPath: `/visit/${v.inviteToken}`,
  };
}

export async function listDayForPractitioner(p: Practitioner, ymd: string) {
  return getVisitStore().list({
    clinicId: p.clinicId,
    practitionerId: p.id,
    from: zonedDate(ymd, 0).toISOString(),
    to: zonedDate(addDays(ymd, 1), 0).toISOString(),
  });
}

/** Visits after today, for the next `days` days (excludes cancelled). */
export async function listUpcomingForPractitioner(p: Practitioner, today: string, days = 14) {
  const visits = await getVisitStore().list({
    clinicId: p.clinicId,
    practitionerId: p.id,
    from: zonedDate(addDays(today, 1), 0).toISOString(),
    to: zonedDate(addDays(today, days + 1), 0).toISOString(),
  });
  return visits.filter((v) => v.status !== 'cancelled');
}

// ── Availability ───────────────────────────────────────────────────

function slotMinutesOk(p: Practitioner, minutes: number) {
  if (minutes < p.hours.start * 60 || minutes + p.slotMinutes > p.hours.end * 60) return false;
  if (minutes < LUNCH.end && minutes + p.slotMinutes > LUNCH.start) return false;
  return (minutes - p.hours.start * 60) % p.slotMinutes === 0;
}

export async function getMonthAvailability(practitioner: Practitioner, month: string, now = Date.now()) {
  const p = schedule(practitioner);
  const today = ymdInTz(now);
  const horizon = addDays(today, BOOKING_HORIZON_DAYS);
  const last = `${month}-${pad(daysInMonth(month))}`;
  const booked = new Set(
    (
      await getVisitStore().list({
        clinicId: p.clinicId,
        practitionerId: p.id,
        from: zonedDate(`${month}-01`, 0).toISOString(),
        to: zonedDate(addDays(last, 1), 0).toISOString(),
      })
    )
      .filter((v) => v.status !== 'cancelled')
      .map((v) => v.start),
  );

  const days: Record<string, string[]> = {};
  for (let d = 1; d <= daysInMonth(month); d++) {
    const ymd = `${month}-${pad(d)}`;
    if (ymd < today || ymd > horizon || !p.workDays.includes(weekday(ymd))) continue;
    const slots: string[] = [];
    for (let t = p.hours.start * 60; t + p.slotMinutes <= p.hours.end * 60; t += p.slotMinutes) {
      if (!slotMinutesOk(p, t)) continue;
      const start = zonedDate(ymd, t);
      if (start.getTime() < earliestStart(now)) continue;
      const s = start.toISOString();
      if (!booked.has(s)) slots.push(s);
    }
    if (slots.length) days[ymd] = slots;
  }
  return days;
}

function isBookableSlot(practitioner: Practitioner, start: Date, now: number) {
  const p = schedule(practitioner);
  if (Number.isNaN(start.getTime()) || start.getSeconds() !== 0 || start.getMilliseconds() !== 0) return false;
  const ymd = ymdInTz(start);
  if (!p.workDays.includes(weekday(ymd))) return false;
  if (start.getTime() < earliestStart(now)) return false;
  if (ymd > addDays(ymdInTz(now), BOOKING_HORIZON_DAYS)) return false;
  return slotMinutesOk(p, minutesInTz(start));
}

// ── Booking ────────────────────────────────────────────────────────

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function createBooking(body: unknown, now = Date.now()): Promise<Result<Visit>> {
  const b = (body ?? {}) as Record<string, unknown>;
  const pIn = (b.patient ?? {}) as Record<string, unknown>;

  const practitioner = getPractitioner(str(b.practitionerId, 64));
  if (!practitioner) return { ok: false, status: 400, error: 'Please choose a physician.' };

  const name = str(pIn.name, 120).replace(/\s+/g, ' ');
  const dateOfBirth = str(pIn.dateOfBirth, 10);
  const email = str(pIn.email, 200).toLowerCase();
  const phoneRaw = str(pIn.phone, 40);
  const phoneDigits = phoneRaw.replace(/\D/g, '');
  const healthCard = str(pIn.healthCardNumber, 20).toUpperCase().replace(/[^0-9A-Z]/g, '');
  const reason = str(b.reason, 500);

  if (name.length < 2) return { ok: false, status: 400, error: 'Please enter your full name.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || dateOfBirth > ymdInTz(now) || dateOfBirth < '1900-01-01')
    return { ok: false, status: 400, error: 'Please enter a valid date of birth.' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, status: 400, error: 'That email address doesn’t look right.' };
  if (phoneRaw && (phoneDigits.length < 10 || phoneDigits.length > 15)) return { ok: false, status: 400, error: 'That phone number doesn’t look right.' };
  if (!email && !phoneDigits) return { ok: false, status: 400, error: 'Add an email or mobile number so we can send your visit link.' };
  if (healthCard && (healthCard.length < 10 || healthCard.length > 12)) return { ok: false, status: 400, error: 'Ontario health card numbers have 10 digits (plus an optional version code).' };
  if (reason.length < 3) return { ok: false, status: 400, error: 'Please tell your doctor briefly what the visit is about.' };
  if (b.consent !== true) return { ok: false, status: 400, error: 'Please agree to the virtual care consent to continue.' };

  const start = new Date(str(b.start, 40));
  if (!isBookableSlot(practitioner, start, now)) return { ok: false, status: 400, error: 'That time isn’t available. Please pick another.' };

  const store = getVisitStore();
  const sameDay = await listDayForPractitioner(practitioner, ymdInTz(start));
  if (sameDay.some((v) => v.status !== 'cancelled' && v.start === start.toISOString()))
    return { ok: false, status: 409, error: 'Someone just booked that time. Please choose another.' };

  const patient: VisitPatient = {
    name,
    dateOfBirth,
    ...(healthCard ? { healthCardNumber: healthCard } : {}),
    ...(email ? { email } : {}),
    ...(phoneDigits ? { phone: phoneRaw.startsWith('+') ? `+${phoneDigits}` : `+1${phoneDigits.slice(-10)}` } : {}),
  };

  const id = `v_${randomBytes(6).toString('hex')}`;
  const visit: Visit = {
    id,
    clinicId: practitioner.clinicId,
    practitionerId: practitioner.id,
    start: start.toISOString(),
    end: iso(start.getTime() + practitioner.slotMinutes * 60_000),
    reason,
    patient,
    inviteToken: randomBytes(24).toString('base64url'),
    roomName: `brevicor-${id}`,
    status: 'scheduled',
    createdAt: iso(now),
    verifyAttempts: 0,
  };
  await store.insert(visit);
  // TODO(notifications): send the invitation link by email/SMS (no PHI in the message body).
  return { ok: true, value: visit };
}

// ── Patient check-in / waiting room ────────────────────────────────

/** Heartbeat from the patient's browser. Checks them in when the waiting room is open. */
export async function checkInAndGetStatus(store: VisitStore, v: Visit, now = Date.now()): Promise<PatientStatus> {
  const start = Date.parse(v.start);
  const canEnterAt = start - EARLY_ENTRY_MIN * 60_000;
  const base = { startsAt: v.start, canEnterAt: iso(canEnterAt), doctorBusy: false, minutesLate: 0 };

  if (v.status === 'cancelled') return { ...base, phase: 'cancelled' };
  if (v.status === 'completed') return { ...base, phase: 'ended' };
  if (v.status === 'in_progress') {
    await store.update(v.id, { lastSeenAt: iso(now) });
    return { ...base, phase: 'in_call' };
  }
  if (now < canEnterAt) return { ...base, phase: 'too_early' };
  if (v.status === 'scheduled' && now > start + LATE_ENTRY_MIN * 60_000) return { ...base, phase: 'expired' };

  // Keep the original arrival time if they stepped away and came back.
  const waitingSince = v.waitingSince ?? iso(now);
  await store.update(v.id, { status: 'waiting', waitingSince, lastSeenAt: iso(now) });

  const day = await store.list({
    clinicId: v.clinicId,
    practitionerId: v.practitionerId,
    from: iso(start - 12 * 3_600_000),
    to: iso(start + 12 * 3_600_000),
  });
  // Queue order mirrors a real clinic: by appointment time, then arrival.
  const queue = day
    .filter((x) => x.status === 'waiting' && (x.id === v.id || isPresent(x, now)))
    .sort((a, b) => a.start.localeCompare(b.start) || (a.waitingSince ?? '').localeCompare(b.waitingSince ?? ''));

  return {
    ...base,
    phase: 'waiting',
    waitingSince,
    queuePosition: queue.findIndex((x) => x.id === v.id) + 1,
    doctorBusy: day.some((x) => x.status === 'in_progress' && x.id !== v.id),
    minutesLate: Math.max(0, Math.floor((now - start) / 60_000)),
  };
}

// ── Physician actions ──────────────────────────────────────────────

export async function admitVisit(v: Visit, now = Date.now()): Promise<Visit | null> {
  if (v.status === 'in_progress') return v;
  if (v.status !== 'waiting' && v.status !== 'scheduled') return null;
  return getVisitStore().update(v.id, { status: 'in_progress', admittedAt: iso(now) });
}

/** Ends the communication session only. Never touches the FHIR Encounter status. */
export async function endVisit(v: Visit, now = Date.now()) {
  if (v.status === 'completed') return v;
  return getVisitStore().update(v.id, { status: 'completed', endedAt: iso(now) });
}
