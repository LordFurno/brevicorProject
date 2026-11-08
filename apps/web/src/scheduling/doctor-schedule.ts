import { addDays, ymdInTz, zonedDate } from '@/lib/time';
type Practitioner = { id: string; clinicId: string; ref?: string };
import { hasEarlyArrival } from './doctor-view';
import { getVisitStore } from '@/lib/visits/store';
import { listDayForPractitioner, listUpcomingForPractitioner } from '@/lib/visits/service';

// Keep patients waiting across midnight visible without changing the visit store
// or reseeding/resetting anyone's appointments.
export async function loadDoctorSchedule(practitioner: Practitioner, now = Date.now()) {
  const today = ymdInTz(now);
  const [current, upcoming, previous] = await Promise.all([
    listDayForPractitioner(practitioner, today),
    listUpcomingForPractitioner(practitioner, today),
    getVisitStore().list({ clinicId: practitioner.clinicId, practitionerRef: practitioner.ref ?? `Practitioner/${practitioner.id}`,
      from: zonedDate(addDays(today, -1), 0).toISOString(), to: zonedDate(today, 0).toISOString() }),
  ]);
  const active = previous.filter((v) => v.status === 'waiting' || v.status === 'in_progress');
  const visits = Array.from(new Map([...active, ...current, ...upcoming.filter((v) => hasEarlyArrival(v, now))].map((v) => [v.id, v])).values()).sort((a, b) => a.start.localeCompare(b.start));
  return { visits, upcoming: upcoming.filter((v) => !hasEarlyArrival(v, now)) };
}
