import { NextResponse } from 'next/server';
import { getCommsServer } from '@/comms/server';
import { authorizedPatient, setCallCookie } from '@/lib/auth/patient';
import { jsonError } from '@/lib/http';
import { appointmentClosed } from '@/lib/visits/service';
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params,
    visit = await authorizedPatient(token);
  if (!visit) return jsonError(401, 'Please confirm your identity.');
  if (appointmentClosed(visit) || visit.status !== 'in_progress' || visit.modality !== 'video')
    return jsonError(409, 'This visit is not accepting joins.');
  try {
    const creds = await getCommsServer().issueJoinCredentials({
      roomName: visit.roomName,
      identity: `patient-${visit.id}`,
      role: 'patient',
    });
    const res = NextResponse.json(creds, { headers: { 'Cache-Control': 'no-store' } });
    setCallCookie(res, visit, token);
    return res;
  } catch {
    return jsonError(503, 'Video service unavailable');
  }
}
