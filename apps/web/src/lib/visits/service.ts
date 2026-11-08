import 'server-only';
import type { Patient } from 'fhir/r4';
import type { GatewayContext } from '@/lib/clinical/gateway';
import { GatewayError, gatewayRead } from '@/lib/clinical/gateway';
import { ensureEncounter, type LinkedEncounter } from '@/lib/clinical/write';
import { appLink, notifyVisit, scheduleNotification } from '@/lib/notify';
import { addDays, zonedDate } from '@/lib/time';
import { getVisitStore, type VisitStore } from './store';
import { hashToken, newInviteToken } from './tokens';
import {
  EARLY_ENTRY_MIN,
  LATE_ENTRY_MIN,
  MAX_VERIFY_ATTEMPTS,
  PRESENCE_TIMEOUT_MS,
  type Visit,
  type DoctorVisitView,
  type PatientStatus,
} from './types';
export type Dispatch = (job: () => Promise<unknown>) => void | Promise<unknown>;
export const immediately: Dispatch = (job) => job();
export const appointmentCancelled = (v: Visit) =>
  ['cancelled', 'entered-in-error', 'noshow'].includes(v.appointmentStatus);
export const appointmentClosed = (v: Visit) =>
  appointmentCancelled(v) || v.appointmentStatus === 'fulfilled';
export function isPresent(v: Visit, now = Date.now()) {
  return (
    v.status === 'waiting' && !!v.lastSeenAt && now - Date.parse(v.lastSeenAt) < PRESENCE_TIMEOUT_MS
  );
}
export function toDoctorView(
  v: Visit,
  now = Date.now(),
  display = { name: 'Patient unavailable', dob: '', reason: '' },
): DoctorVisitView {
  return {
    id: v.id,
    start: v.start,
    end: v.end,
    status: v.status,
    modality: v.modality,
    present: isPresent(v, now),
    waitingSince: v.waitingSince,
    admittedAt: v.admittedAt,
    endedAt: v.endedAt,
    patientName: display.name,
    patientDateOfBirth: display.dob,
    reason: display.reason,
  };
}
type Physician = { id: string; clinicId: string; ref?: string };
export function listDayForPractitioner(p: Physician, ymd: string) {
  return getVisitStore().list({
    clinicId: p.clinicId,
    practitionerRef: p.ref ?? `Practitioner/${p.id}`,
    from: zonedDate(ymd, 0).toISOString(),
    to: zonedDate(addDays(ymd, 1), 0).toISOString(),
  });
}
export async function listUpcomingForPractitioner(p: Physician, today: string, days = 14) {
  return (
    await getVisitStore().list({
      clinicId: p.clinicId,
      practitionerRef: p.ref ?? `Practitioner/${p.id}`,
      from: zonedDate(addDays(today, 1), 0).toISOString(),
      to: zonedDate(addDays(today, days + 1), 0).toISOString(),
    })
  ).filter((v) => v.status !== 'cancelled');
}
export async function heartbeat(store: VisitStore, v: Visit, now = Date.now()) {
  return store.mutate(v.clinicId, v.id, (current) =>
    current && current.inviteTokenHash === v.inviteTokenHash
      ? { visit: { ...current, lastSeenAt: new Date(now).toISOString() }, events: [] }
      : null,
  );
}
export async function checkInAndGetStatus(
  store: VisitStore,
  v: Visit,
  now = Date.now(),
  dispatch: Dispatch = immediately,
): Promise<PatientStatus> {
  const changed = await store.mutate(v.clinicId, v.id, (current) => {
    if (!current || current.inviteTokenHash !== v.inviteTokenHash) return null;
    if (current.status === 'completed' || current.status === 'cancelled') return null;
    if (appointmentClosed(current) && current.status !== 'in_progress') return null;
    const start = Date.parse(current.start);
    if (
      current.status === 'scheduled' &&
      (now < start - EARLY_ENTRY_MIN * 60000 || now > start + LATE_ENTRY_MIN * 60000)
    )
      return null;
    const first = current.status === 'scheduled';
    return {
      visit: {
        ...current,
        status: first ? 'waiting' : current.status,
        waitingSince: first
          ? (current.waitingSince ?? new Date(now).toISOString())
          : current.waitingSince,
        lastSeenAt: new Date(now).toISOString(),
      },
      events: first ? [{ type: 'checked_in', actor: 'patient' }] : [],
    };
  });
  const current = changed?.visit ?? (await store.get(v.clinicId, v.id)) ?? v;
  const start = Date.parse(current.start),
    base = {
      startsAt: current.start,
      canEnterAt: new Date(start - EARLY_ENTRY_MIN * 60000).toISOString(),
      doctorBusy: false,
      minutesLate: 0,
    };
  if (current.status === 'completed') return { ...base, phase: 'ended' };
  if (current.status === 'cancelled') return { ...base, phase: 'cancelled' };
  if (current.status === 'in_progress') return { ...base, phase: 'in_call' };
  if (appointmentClosed(current))
    return { ...base, phase: current.appointmentStatus === 'fulfilled' ? 'ended' : 'cancelled' };
  if (now < start - EARLY_ENTRY_MIN * 60000) return { ...base, phase: 'too_early' };
  if (current.status === 'scheduled') return { ...base, phase: 'expired' };
  if (changed?.events.some((e) => e.type === 'checked_in')) {
    await scheduleNotification(dispatch, async () =>
      notifyVisit(store, current, {
        type: 'patient_waiting',
        dedupeKey: `patient_waiting:${current.id}`,
        appointmentRef: current.appointmentRef,
        practitionerRef: current.practitionerRef,
        link: appLink('/doctor'),
      }),
    );
  }
  const day = await store.list({
    clinicId: current.clinicId,
    practitionerRef: current.practitionerRef,
    from: new Date(start - 12 * 3600000).toISOString(),
    to: new Date(start + 12 * 3600000).toISOString(),
  });
  const queue = day
    .filter((x) => x.status === 'waiting' && (x.id === current.id || isPresent(x, now)))
    .sort(
      (a, b) =>
        a.start.localeCompare(b.start) ||
        (a.waitingSince ?? '').localeCompare(b.waitingSince ?? ''),
    );
  return {
    ...base,
    phase: 'waiting',
    waitingSince: current.waitingSince,
    queuePosition: queue.findIndex((x) => x.id === current.id) + 1,
    doctorBusy: day.some((x) => x.status === 'in_progress' && x.id !== current.id),
    minutesLate: Math.max(0, Math.floor((now - start) / 60000)),
  };
}
export async function admitVisit(v: Visit, now = Date.now(), store = getVisitStore()) {
  const result = await store.mutate(v.clinicId, v.id, (current) => {
    if (
      !current ||
      current.practitionerRef !== v.practitionerRef ||
      current.patientRef !== v.patientRef ||
      appointmentClosed(current) ||
      !['waiting', 'scheduled', 'in_progress'].includes(current.status)
    )
      return null;
    return {
      visit:
        current.status === 'in_progress'
          ? current
          : { ...current, status: 'in_progress', admittedAt: new Date(now).toISOString() },
      events: current.status === 'in_progress' ? [] : [{ type: 'admitted', actor: 'physician' }],
    };
  });
  return result?.visit ?? null;
}
/** Audit code for a failed EHR write: the HTTP status only, never a message. */
export function writeErrorCode(e: unknown) {
  return e instanceof GatewayError ? `gateway:${e.status}` : 'gateway:unavailable';
}

/**
 * After admitting: open the visit's FHIR Encounter (conditional create, so a
 * second admit or retry reuses it) and remember it on the visit. A failed
 * write is recorded as an event and never blocks the consultation. Ending a
 * call never touches this Encounter.
 */
export async function linkEncounter(
  v: Visit,
  ctx: GatewayContext,
  store = getVisitStore(),
  create: (v: Visit, ctx: GatewayContext) => Promise<LinkedEncounter> = ensureEncounter,
): Promise<Visit> {
  if (v.encounterRef) return v;
  try {
    const encounter = await create(v, ctx);
    const result = await store.mutate(v.clinicId, v.id, (current) =>
      !current || current.encounterRef
        ? null
        : {
            visit: { ...current, encounterRef: encounter.ref },
            events: [{ type: 'encounter_linked', actor: 'physician', meta: { result: encounter.result, syncStatus: encounter.syncStatus } }],
          },
    );
    return result?.visit ?? (await store.get(v.clinicId, v.id)) ?? v;
  } catch (e) {
    console.error('[visits] encounter write failed:', writeErrorCode(e));
    await store
      .mutate(v.clinicId, v.id, (current) =>
        current ? { visit: current, events: [{ type: 'encounter_failed', actor: 'physician', meta: { errorCode: writeErrorCode(e) } }] } : null,
      )
      .catch(() => console.error('[visits] could not record the failed encounter write'));
    return v;
  }
}

export async function endVisit(v: Visit, now = Date.now(), store = getVisitStore()) {
  const result = await store.mutate(v.clinicId, v.id, (current) =>
    current &&
    current.practitionerRef === v.practitionerRef &&
    current.patientRef === v.patientRef &&
    current.status !== 'cancelled'
      ? {
          visit: {
            ...current,
            status: 'completed',
            endedAt: current.endedAt ?? new Date(now).toISOString(),
          },
          events: current.status === 'completed' ? [] : [{ type: 'ended', actor: 'physician' }],
        }
      : null,
  );
  return result?.visit ?? null;
}
export async function rotateInvitation(store: VisitStore, v: Visit) {
  const token = newInviteToken(v.clinicId);
  const result = await store.mutate(v.clinicId, v.id, (current) =>
    current &&
    current.practitionerRef === v.practitionerRef &&
    current.patientRef === v.patientRef &&
    !appointmentClosed(current) &&
    !['cancelled', 'completed'].includes(current.status)
      ? {
          visit: { ...current, inviteTokenHash: hashToken(token), verifyAttempts: 0 },
          events: [{ type: 'invited', actor: 'physician' }],
        }
      : null,
  );
  return result ? token : null;
}
export async function verifyPatient(
  store: VisitStore,
  v: Visit,
  token: string,
  dob: string,
  readPatient = (ref: string, ctx: GatewayContext) => gatewayRead<Patient>(ref, ctx),
) {
  if (v.verifyAttempts >= MAX_VERIFY_ATTEMPTS)
    return { status: 429, attempts: MAX_VERIFY_ATTEMPTS };
  if (appointmentClosed(v) || ['completed', 'cancelled'].includes(v.status))
    return { status: 409, attempts: v.verifyAttempts };
  const patient = await readPatient(v.patientRef, { clinicId: v.clinicId });
  const correct =
    !!patient.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(dob) && dob === patient.birthDate;
  const result = await store.mutate(v.clinicId, v.id, (current) => {
    if (
      !current ||
      current.inviteTokenHash !== hashToken(token) ||
      current.patientRef !== v.patientRef ||
      current.verifyAttempts >= MAX_VERIFY_ATTEMPTS ||
      appointmentClosed(current) ||
      ['completed', 'cancelled'].includes(current.status)
    )
      return null;
    return {
      visit: { ...current, verifyAttempts: correct ? 0 : current.verifyAttempts + 1 },
      events: [{ type: correct ? 'verified' : 'verify_failed', actor: 'patient' }],
    };
  });
  return {
    status: result ? (correct ? 200 : 401) : 429,
    attempts: result?.visit.verifyAttempts ?? MAX_VERIFY_ATTEMPTS,
  };
}
