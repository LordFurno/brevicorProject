import 'server-only';
import type { Appointment } from 'fhir/r4';
import {
  gatewayRead,
  gatewaySearch,
  GatewayError,
  type GatewayContext,
} from '@/lib/clinical/gateway';
import { appLink, notifyVisit, scheduleNotification, type NotificationType } from '@/lib/notify';
import { addDays, ymdInTz, zonedDate } from '@/lib/time';
import { getVisitStore, type VisitStore } from './store';
import { appointmentVisitId, hashToken, newInviteToken } from './tokens';
import { immediately, type Dispatch } from './service';
import type { Visit, VisitEvent } from './types';
const SYSTEM = 'https://brevicor.ca/fhir/CodeSystem/consultation-modality';
const cancelled = (s: string) => ['cancelled', 'entered-in-error', 'noshow'].includes(s);
export interface SyncRange {
  from: string;
  to: string;
}
export function defaultSyncRange(now = Date.now()): SyncRange {
  const from = ymdInTz(now);
  return { from, to: addDays(from, 15) };
}
interface Dependencies {
  store?: VisitStore;
  search?: (path: string, ctx: GatewayContext) => Promise<Appointment[]>;
  read?: (path: string, ctx: GatewayContext) => Promise<Appointment>;
  dispatch?: Dispatch;
  /** Called with the raw token of each new invitation (the link that is also sent). */
  onInvited?: (appointmentRef: string, token: string) => void;
}
export async function syncVisits(
  clinicId: string,
  range = defaultSyncRange(),
  deps: Dependencies = {},
) {
  if (
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(clinicId) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(range.from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(range.to) ||
    range.from >= range.to
  )
    throw new Error('Invalid sync range');
  const store = deps.store ?? getVisitStore(),
    ctx = { clinicId },
    dispatch = deps.dispatch ?? immediately;
  const search = deps.search ?? gatewaySearch<Appointment>,
    read = deps.read ?? gatewayRead<Appointment>;
  const appointments = await search(
    `Appointment?date=ge${range.from}&date=lt${range.to}&_count=100`,
    ctx,
  );
  const existing = await store.list({
    clinicId,
    from: zonedDate(range.from, 0).toISOString(),
    to: zonedDate(range.to, 0).toISOString(),
  });
  const refs = new Set(appointments.map((a) => `Appointment/${a.id}`));
  let unavailable = 0;
  for (const visit of existing)
    if (!refs.has(visit.appointmentRef)) {
      try {
        appointments.push(await read(visit.appointmentRef, ctx));
      } catch (e) {
        if (e instanceof GatewayError && e.status === 404) unavailable++;
        else throw e;
      }
    }
  const summary = { created: 0, rescheduled: 0, cancelled: 0, updated: 0, ignored: 0, unavailable };
  // Bound parallel writes and notification requests.
  for (let offset = 0; offset < appointments.length; offset += 4)
    await Promise.all(
      appointments.slice(offset, offset + 4).map(async (a) => {
        const code = a.serviceType
          ?.flatMap((c) => c.coding ?? [])
          .find((c) => c.system === SYSTEM && ['video', 'telephone'].includes(c.code ?? ''))?.code;
        const patientRef = a.participant.find((p) => p.actor?.reference?.startsWith('Patient/'))
          ?.actor?.reference;
        const practitionerRef = a.participant.find((p) =>
          p.actor?.reference?.startsWith('Practitioner/'),
        )?.actor?.reference;
        if (
          !a.id ||
          !code ||
          !patientRef ||
          !practitionerRef ||
          !a.start ||
          !a.end ||
          !Number.isFinite(Date.parse(a.start)) ||
          !Number.isFinite(Date.parse(a.end)) ||
          Date.parse(a.end) <= Date.parse(a.start)
        ) {
          summary.ignored++;
          return;
        }
        const appointmentRef = `Appointment/${a.id}`,
          id = appointmentVisitId(clinicId, appointmentRef),
          token = newInviteToken(clinicId),
          now = new Date().toISOString();
        const result = await store.mutate(clinicId, id, (current) => {
          if (!current && !['booked', 'arrived', 'checked-in', 'cancelled'].includes(a.status))
            return null;
          const moved = !!current && Date.parse(current.start) !== Date.parse(a.start!);
          const identityChanged = !!current && current.patientRef !== patientRef;
          const wasCancelled = current ? cancelled(current.appointmentStatus) : false,
            isCancelled = cancelled(a.status);
          const reopened = !!current && wasCancelled && !isCancelled;
          const events: VisitEvent[] = [];
          let visit: Visit = current ?? {
            id,
            clinicId,
            appointmentRef,
            patientRef,
            practitionerRef,
            modality: code === 'video' ? 'video' : 'phone',
            start: a.start!,
            end: a.end!,
            status: isCancelled ? 'cancelled' : 'scheduled',
            appointmentStatus: a.status,
            inviteTokenHash: hashToken(token),
            roomName: `brevicor-${id}`,
            verifyAttempts: 0,
            revision: 0,
            createdAt: now,
            updatedAt: now,
          };
          if (!current) {
            events.push({ type: 'synced', actor: 'system' });
            if (!isCancelled) events.push({ type: 'invited', actor: 'system' });
          } else if (
            (moved || identityChanged || reopened) &&
            current.status !== 'completed' &&
            a.status !== 'fulfilled'
          ) {
            visit = { ...visit, inviteTokenHash: hashToken(token), verifyAttempts: 0 };
            if (visit.status !== 'in_progress' && visit.status !== 'completed')
              visit = {
                ...visit,
                status: 'scheduled',
                waitingSince: undefined,
                lastSeenAt: undefined,
              };
            events.push({
              type: moved ? 'rescheduled' : 'invited',
              actor: 'system',
              meta: { start: a.start! },
            });
          }
          if (current && isCancelled && !wasCancelled)
            events.push({ type: 'cancelled', actor: 'system', meta: { status: a.status } });
          visit = {
            ...visit,
            patientRef,
            practitionerRef,
            modality: code === 'video' ? 'video' : 'phone',
            start: a.start!,
            end: a.end!,
            appointmentStatus: a.status,
          };
          if (isCancelled && visit.status !== 'in_progress' && visit.status !== 'completed')
            visit.status = 'cancelled';
          if (current && JSON.stringify(visit) === JSON.stringify(current) && events.length === 0)
            return null;
          if (events.length === 0) events.push({ type: 'synced', actor: 'system' });
          return { visit, events };
        });
        if (!result) {
          summary.ignored++;
          return;
        }
        const events = result.events.map((e) => e.type);
        let type: NotificationType | undefined;
        if (events.includes('cancelled')) {
          type = 'visit_cancelled';
          summary.cancelled++;
        } else if (
          events.includes('rescheduled') &&
          !cancelled(a.status) &&
          result.visit.status !== 'completed' &&
          a.status !== 'fulfilled'
        ) {
          type = 'visit_rescheduled';
          summary.rescheduled++;
        } else if (events.includes('invited')) {
          type = 'visit_invitation';
          summary.created++;
          deps.onInvited?.(appointmentRef, token);
        } else summary.updated++;
        if (type) {
          const notificationType = type,
            visit = result.visit;
          await scheduleNotification(dispatch, async () =>
            notifyVisit(store, visit, {
              type: notificationType,
              dedupeKey: `${notificationType}:${visit.id}:${notificationType === 'visit_cancelled' ? a.status : Date.parse(visit.start)}:${visit.revision}`,
              appointmentRef: visit.appointmentRef,
              patientRef: visit.patientRef,
              ...(notificationType === 'visit_cancelled'
                ? {}
                : { link: appLink(`/visit/${token}`) }),
            }),
          );
        }
      }),
    );
  return summary;
}
