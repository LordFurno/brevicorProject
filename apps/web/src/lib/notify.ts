import 'server-only';
import type { Visit } from './visits/types';
import type { VisitStore } from './visits/store';
export type NotificationType =
  'visit_invitation' | 'visit_rescheduled' | 'visit_cancelled' | 'patient_waiting';
export interface NotificationInput {
  type: NotificationType;
  dedupeKey: string;
  appointmentRef: string;
  patientRef?: string;
  practitionerRef?: string;
  link?: string;
}
export interface NotificationResult {
  results: {
    status: string;
    errorCode?: string | null;
    provider?: string | null;
    providerMessageId?: string | null;
  }[];
  deduplicated?: boolean;
}
export async function scheduleNotification(
  dispatch: (job: () => Promise<unknown>) => void | Promise<unknown>,
  job: () => Promise<unknown>,
) {
  try {
    await dispatch(async () => {
      try {
        return await job();
      } catch {
        return null;
      }
    });
  } catch {
    /* Scheduling or configuration errors cannot fail the visit operation. */
  }
}
export function appLink(path: string) {
  const base = process.env.APP_BASE_URL;
  if (!base) throw new Error('APP_BASE_URL is required');
  return `${base.replace(/\/$/, '')}${path}`;
}
export async function notify(
  clinicId: string,
  input: NotificationInput,
): Promise<NotificationResult> {
  try {
    const url = process.env.NOTIFY_API_URL,
      token = process.env.INTERNAL_SERVICE_TOKEN;
    if (!url || !token) throw new Error('Notification configuration missing');
    const response = await fetch(`${url.replace(/\/$/, '')}/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Clinic-Id': clinicId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok)
      return { results: [{ status: 'failed', errorCode: `http:${response.status}` }] };
    return await response.json();
  } catch {
    return { results: [{ status: 'failed', errorCode: 'notify_unavailable' }] };
  }
}
export async function notifyVisit(store: VisitStore, visit: Visit, input: NotificationInput) {
  const outcome = await notify(visit.clinicId, input);
  try {
    await store.mutate(visit.clinicId, visit.id, (current) =>
      current
        ? {
            visit: current,
            events: outcome.results.map((r) => ({
              type:
                r.status === 'sent'
                  ? 'notification_sent'
                  : r.status === 'failed'
                    ? 'notification_failed'
                    : 'notification_skipped',
              actor: 'system',
              meta: {
                notificationType: input.type,
                result: r.status,
                ...(r.errorCode ? { errorCode: r.errorCode } : {}),
              },
            })),
          }
        : null,
    );
  } catch {
    /* Delivery/audit failures never roll back an already committed visit. */
  }
  return outcome;
}
