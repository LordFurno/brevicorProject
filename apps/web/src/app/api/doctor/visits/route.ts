import { getDoctor } from '@/lib/auth/doctor';
import { json, jsonError } from '@/lib/http';
import { loadDoctorSchedule } from '@/scheduling/doctor-schedule';
import { visitViews } from '@/lib/visits/display';

export const dynamic = 'force-dynamic';

// GET /api/doctor/visits — today's schedule + waiting room + upcoming bookings for the signed-in physician.
export async function GET() {
  const doctor = await getDoctor();
  if (!doctor) return jsonError(401, 'Unauthorized');
  const now = Date.now();
  const { visits, upcoming } = await loadDoctorSchedule(doctor.practitioner, now);
  const ctx = { clinicId: doctor.clinicId, accessToken: doctor.accessToken };
  const [views, upcomingViews] = await Promise.all([
    visitViews(visits, ctx, now),
    visitViews(upcoming, ctx, now),
  ]);
  return json({ visits: views, upcoming: upcomingViews });
}
