import { after } from 'next/server';
import { getDoctor } from '@/lib/auth/doctor';
import { json, jsonError } from '@/lib/http';
import { syncVisits } from '@/lib/visits/sync';
export const maxDuration = 60;
export async function POST() {
  const doctor = await getDoctor();
  if (!doctor) return jsonError(401, 'Unauthorized');
  try {
    return json(await syncVisits(doctor.clinicId, undefined, { dispatch: (job) => after(job) }));
  } catch {
    return jsonError(503, 'Appointments could not sync. Please retry.');
  }
}
