import { getDoctor } from '@/lib/auth/doctor';
import { json, jsonError } from '@/lib/http';
import { ymdInTz } from '@/lib/time';
import { listDayForPractitioner, listUpcomingForPractitioner, toDoctorView } from '@/lib/visits/service';

export const dynamic = 'force-dynamic';

// GET /api/doctor/visits — today's schedule + waiting room + upcoming bookings for the signed-in physician.
export async function GET() {
  const doctor = await getDoctor();
  if (!doctor) return jsonError(401, 'Unauthorized');
  const now = Date.now();
  const today = ymdInTz(now);
  const [visits, upcoming] = await Promise.all([
    listDayForPractitioner(doctor.practitioner, today),
    listUpcomingForPractitioner(doctor.practitioner, today),
  ]);
  return json({
    visits: visits.map((v) => toDoctorView(v, now)),
    upcoming: upcoming.map((v) => toDoctorView(v, now)),
  });
}
