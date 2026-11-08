import { getDoctor, CLINIC_COOKIE } from '@/lib/auth/doctor';
import { json, jsonError, readJson, wrongOrigin } from '@/lib/http';
import { cookieOptions } from '@/lib/auth/signing';
export async function POST(req: Request) {
  if (wrongOrigin(req)) return jsonError(403, 'Invalid request origin');
  const doctor = await getDoctor();
  if (!doctor) return jsonError(401, 'Unauthorized');
  const body = (await readJson(req)) as { clinicId?: unknown } | null;
  if (!doctor.memberships.some((m) => m.clinicId === body?.clinicId))
    return jsonError(403, 'Clinic unavailable');
  const res = json({ ok: true });
  res.cookies.set(CLINIC_COOKIE, body!.clinicId as string, cookieOptions(12 * 3600));
  return res;
}
