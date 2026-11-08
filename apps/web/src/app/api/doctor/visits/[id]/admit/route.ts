import { getDoctor, ownsVisit } from '@/lib/auth/doctor';
import { json, jsonError } from '@/lib/http';
import { admitVisit, toDoctorView } from '@/lib/visits/service';
import { getVisitStore } from '@/lib/visits/store';

// POST /api/doctor/visits/:id/admit — "call the patient in" from the waiting room.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doctor = await getDoctor();
  if (!doctor) return jsonError(401, 'Unauthorized');
  const visit = await getVisitStore().get(id);
  if (!visit || !ownsVisit(doctor, visit)) return jsonError(404, 'Visit not found');
  const admitted = await admitVisit(visit);
  if (!admitted) return jsonError(409, 'This visit has already ended.');
  return json(toDoctorView(admitted));
}
