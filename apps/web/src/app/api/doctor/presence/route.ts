import { getDoctor } from '@/lib/auth/doctor';
import { json, jsonError } from '@/lib/http';
export async function POST() {
  const doctor = await getDoctor();
  if (!doctor) return jsonError(401, 'Unauthorized');
  try {
    const response = await fetch(`${process.env.NOTIFY_API_URL?.replace(/\/$/, '')}/presence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${doctor.accessToken}`, 'X-Clinic-Id': doctor.clinicId },
      signal: AbortSignal.timeout(5000),
    });
    return json({ ok: response.ok });
  } catch {
    return json({ ok: false });
  }
}
