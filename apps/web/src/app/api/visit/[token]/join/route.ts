import { getCommsServer } from '@/comms/server';
import { isPatientVerified } from '@/lib/auth/patient';
import { json, jsonError } from '@/lib/http';
import { getVisitStore } from '@/lib/visits/store';

// POST /api/visit/:token/join — only works once the physician has called the patient in.
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const visit = await getVisitStore().getByToken(token);
  if (!visit) return jsonError(404, 'This visit link isn’t valid.');
  if (!(await isPatientVerified(visit.id))) return jsonError(401, 'Please confirm your identity.');
  if (visit.status !== 'in_progress') return jsonError(409, 'Your doctor hasn’t called you in yet.');
  try {
    const creds = await getCommsServer().issueJoinCredentials({
      roomName: visit.roomName,
      identity: `patient-${visit.id}`,
      role: 'patient',
    });
    return json(creds);
  } catch (e) {
    return jsonError(503, e instanceof Error ? e.message : 'Video service unavailable');
  }
}
