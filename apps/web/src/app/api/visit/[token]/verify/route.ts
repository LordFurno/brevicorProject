import { NextResponse } from 'next/server';
import { setPatientCookie } from '@/lib/auth/patient';
import { jsonError, readJson } from '@/lib/http';
import { getVisitStore } from '@/lib/visits/store';
import { MAX_VERIFY_ATTEMPTS } from '@/lib/visits/types';

// POST /api/visit/:token/verify  { dateOfBirth: "YYYY-MM-DD" }
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const store = getVisitStore();
  const visit = await store.getByToken(token);
  if (!visit) return jsonError(404, 'This visit link isn’t valid.');
  if (visit.verifyAttempts >= MAX_VERIFY_ATTEMPTS)
    return jsonError(429, 'Too many attempts. Please call your clinic to confirm your visit.');

  const body = (await readJson(req)) as { dateOfBirth?: unknown } | null;
  const dob = typeof body?.dateOfBirth === 'string' ? body.dateOfBirth.trim() : '';

  if (dob !== visit.patient.dateOfBirth) {
    const attempts = visit.verifyAttempts + 1;
    await store.update(visit.id, { verifyAttempts: attempts });
    const left = MAX_VERIFY_ATTEMPTS - attempts;
    return jsonError(
      401,
      left > 0
        ? `That date of birth doesn’t match our records. ${left} ${left === 1 ? 'try' : 'tries'} left.`
        : 'Too many attempts. Please call your clinic to confirm your visit.',
    );
  }

  await store.update(visit.id, { verifyAttempts: 0 });
  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  setPatientCookie(res, visit.id);
  return res;
}
