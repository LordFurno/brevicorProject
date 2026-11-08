import { getCommsServer } from '@/comms/server';
import { getDoctor, ownsVisit } from '@/lib/auth/doctor';
import { json, jsonError } from '@/lib/http';
import { admitVisit } from '@/lib/visits/service';
import { getVisitStore } from '@/lib/visits/store';

// POST /api/doctor/visits/:id/join — video credentials for the physician (admits if needed).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doctor = await getDoctor();
  if (!doctor) return jsonError(401, 'Unauthorized');
  const visit = await getVisitStore().get(doctor.clinicId, id);
  if (!visit || !ownsVisit(doctor, visit)) return jsonError(404, 'Visit not found');
  if (visit.modality !== 'video') return jsonError(409, 'Please call through your clinic phone system.');
  const admitted = await admitVisit(visit);
  if (!admitted) return jsonError(409, 'This visit has already ended.');
  try {
    const creds = await getCommsServer().issueJoinCredentials({
      roomName: admitted.roomName,
      identity: `physician-${doctor.userId}`,
      role: 'physician',
    });
    return json(creds);
  } catch (e) {
    return jsonError(503, e instanceof Error ? e.message : 'Video service unavailable');
  }
}
