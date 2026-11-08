import { NextResponse } from 'next/server';
import { clearDoctorCookie } from '@/lib/auth/doctor';
import { sessionClient } from '@/lib/supabase/session';

export async function POST() {
  await (await sessionClient()).auth.signOut();
  const res = NextResponse.json({ ok: true });
  clearDoctorCookie(res);
  return res;
}
