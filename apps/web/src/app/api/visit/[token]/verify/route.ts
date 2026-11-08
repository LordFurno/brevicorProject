import { NextResponse } from 'next/server';
import { setPatientCookie } from '@/lib/auth/patient';
import { jsonError, readJson } from '@/lib/http';
import { getVisitStore } from '@/lib/visits/store';
import { verifyPatient } from '@/lib/visits/service';
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params,
    store = getVisitStore(),
    visit = await store.getByToken(token);
  if (!visit) return jsonError(404, 'This visit link is not valid.');
  const body = (await readJson(req)) as { dateOfBirth?: unknown } | null,
    dob = typeof body?.dateOfBirth === 'string' ? body.dateOfBirth.trim() : '';
  try {
    const result = await verifyPatient(store, visit, token, dob);
    if (result.status !== 200)
      return jsonError(
        result.status,
        result.status === 429 || result.attempts >= 5
          ? 'Too many attempts. Please call your clinic.'
          : result.status === 409
            ? 'This visit is closed.'
            : `Date of birth does not match. ${5 - result.attempts} tries left.`,
      );
    const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    setPatientCookie(res, visit);
    return res;
  } catch {
    return jsonError(503, 'Clinic records are unavailable. Please retry.');
  }
}
