import { NextResponse } from 'next/server';
import { authenticate, setDoctorCookie } from '@/lib/auth/doctor';
import { jsonError, readJson } from '@/lib/http';

export async function POST(req: Request) {
  const body = (await readJson(req)) as { email?: unknown; password?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!email || !password) return jsonError(400, 'Enter your email and password.');

  const practitioner = await authenticate(email, password);
  if (!practitioner) return jsonError(401, 'That email and password don’t match our records.');

  const res = NextResponse.json({ ok: true });
  setDoctorCookie(res, practitioner);
  return res;
}
