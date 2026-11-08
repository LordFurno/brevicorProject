import { bookingEnabled } from '@/lib/booking';
import { getVisitStore } from '@/lib/visits/booking-store';
import { json, jsonError, readJson } from '@/lib/http';
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!bookingEnabled()) return jsonError(404, 'Not found');
  const store = getVisitStore(),
    visit = await store.getByToken((await params).token);
  if (!visit) return jsonError(404, 'Not found');
  if (visit.verifyAttempts >= 5) return jsonError(429, 'Please contact your clinic');
  const body = (await readJson(req)) as { dateOfBirth?: string } | null;
  if (body?.dateOfBirth !== visit.patient.dateOfBirth) {
    await store.update(visit.id, { verifyAttempts: visit.verifyAttempts + 1 });
    return jsonError(401, 'Unable to verify');
  }
  return json({ ok: true });
}
