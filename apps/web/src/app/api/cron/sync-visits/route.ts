import { timingSafeEqual, createHash } from 'node:crypto';
import { json, jsonError } from '@/lib/http';
import { syncVisits } from '@/lib/visits/sync';
export const maxDuration = 60;
export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  if (
    !expected ||
    !timingSafeEqual(digest(req.headers.get('authorization') ?? ''), digest(`Bearer ${expected}`))
  )
    return jsonError(401, 'Unauthorized');
  const clinicId = new URL(req.url).searchParams.get('clinicId');
  if (!clinicId || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(clinicId))
    return jsonError(400, 'clinicId is required');
  try {
    return json(await syncVisits(clinicId));
  } catch {
    return jsonError(503, 'Appointments could not sync');
  }
}
