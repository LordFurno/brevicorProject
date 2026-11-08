import { toDoctorView } from '@/lib/visits/service';
import { PRESENCE_TIMEOUT_MS } from '@/lib/visits/types';
import type { DoctorVisitView, Visit } from '@/lib/visits/types';

export type DoctorScheduleView = DoctorVisitView & { arrivedEarly?: boolean };
export function hasEarlyArrival(visit: Visit, now: number) {
  const seen = visit.lastSeenAt ? Date.parse(visit.lastSeenAt) : NaN;
  return visit.status === 'scheduled' && Number.isFinite(seen) && now - seen >= 0 && now - seen < PRESENCE_TIMEOUT_MS;
}
export function toScheduleView(visit: Visit, now: number): DoctorScheduleView {
  const view = toDoctorView(visit, now);
  return hasEarlyArrival(visit, now) ? { ...view, arrivedEarly: true, present: true } : view;
}
