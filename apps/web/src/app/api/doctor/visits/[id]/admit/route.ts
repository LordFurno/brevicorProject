import { getDoctor, ownsVisit } from '@/lib/auth/doctor';
import { json, jsonError } from '@/lib/http';
import { admitVisit, linkEncounter, toDoctorView } from '@/lib/visits/service';
import { getVisitStore } from '@/lib/visits/store';

// POST /api/doctor/visits/:id/admit — "call the patient in" from the waiting room.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doctor = await getDoctor();
  if (!doctor) return jsonError(401, 'Unauthorized');
  const visit = await getVisitStore().get(doctor.clinicId, id);
  if (!visit || !ownsVisit(doctor, visit)) return jsonError(404, 'Visit not found');
  const admitted = await admitVisit(visit);
  if (!admitted) return jsonError(409, 'This visit has already ended.');
  // Opens the FHIR Encounter with the physician's token. Never blocks admitting:
  // a failed EHR write is recorded as a visit event and the call goes ahead.
  const linked = await linkEncounter(admitted, { clinicId: doctor.clinicId, accessToken: doctor.accessToken });
  return json(toDoctorView(linked));
}
