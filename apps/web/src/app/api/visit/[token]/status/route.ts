import { isPatientVerified } from '@/lib/auth/patient';
import { json, jsonError } from '@/lib/http';
import { checkInAndGetStatus } from '@/lib/visits/service';
import { getVisitStore } from '@/lib/visits/store';

// POST /api/visit/:token/status — patient heartbeat (every few seconds while the page is open).
// Checks the patient into the waiting room and returns their place in line.
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const store = getVisitStore();
  const visit = await store.getByToken(token);
  if (!visit) return jsonError(404, 'This visit link isn’t valid.');
  if (!(await isPatientVerified(visit.id))) return jsonError(401, 'Please confirm your identity.');
  const now = Date.now();
  const status = await checkInAndGetStatus(store, visit, now);
  // A verified patient can test their camera before formal check-in opens.
  // Report their presence to the physician without changing the scheduled status
  // or bypassing the existing early-entry window.
  if (status.phase === 'too_early') await store.update(visit.id, { lastSeenAt: new Date(now).toISOString() });
  return json(status);
}
