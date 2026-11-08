import { after } from 'next/server';
import { authorizedPatient } from '@/lib/auth/patient';
import { json, jsonError } from '@/lib/http';
import { checkInAndGetStatus, heartbeat } from '@/lib/visits/service';
import { getVisitStore } from '@/lib/visits/store';
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params,
    visit = await authorizedPatient(token, true);
  if (!visit) return jsonError(401, 'Please confirm your identity using your current visit link.');
  const store = getVisitStore(),
    now = Date.now();
  const status = await checkInAndGetStatus(store, visit, now, (job) => after(job));
  if (status.phase === 'too_early') await heartbeat(store, visit, now);
  return json(status);
}
