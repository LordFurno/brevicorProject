import { getCommsServer } from '@/comms/server';
import { getDoctor, ownsVisit } from '@/lib/auth/doctor';
import { json, jsonError } from '@/lib/http';
import { endVisit } from '@/lib/visits/service';
import { getVisitStore } from '@/lib/visits/store';

// POST /api/doctor/visits/:id/end — ends the call for everyone.
// Per spec: this does NOT mark the clinical Encounter as completed.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doctor = await getDoctor();
  if (!doctor) return jsonError(401, 'Unauthorized');
  const visit = await getVisitStore().get(doctor.clinicId, id);
  if (!visit || !ownsVisit(doctor, visit)) return jsonError(404, 'Visit not found');

  const ended = await endVisit(visit);
  try {
    await getCommsServer().endRoom?.(visit.roomName);
  } catch {
    /* best effort */
  }
  const duration =
    ended?.admittedAt && ended.endedAt ? Math.round((Date.parse(ended.endedAt) - Date.parse(ended.admittedAt)) / 1000) : 0;
  return json({ session_id: visit.id, status: 'completed', duration_seconds: duration });
}
