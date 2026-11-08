import { getDoctor } from '@/lib/auth/doctor';
import { json, jsonError } from '@/lib/http';
import { toScheduleView } from '@/scheduling/doctor-view';
import { loadDoctorSchedule } from '@/scheduling/doctor-schedule';

export const dynamic = 'force-dynamic';

// GET /api/doctor/visits — today's schedule + waiting room + upcoming bookings for the signed-in physician.
export async function GET() {
  const doctor = await getDoctor();
  if (!doctor) return jsonError(401, 'Unauthorized');
  const now = Date.now();
  const { visits, upcoming } = await loadDoctorSchedule(doctor.practitioner, now);
  return json({
    visits: visits.map((v) => toScheduleView(v, now)),
    upcoming: upcoming.map((v) => toScheduleView(v, now)),
  });
}
