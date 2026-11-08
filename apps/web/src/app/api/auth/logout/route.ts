import { NextResponse } from 'next/server';
import { clearDoctorCookie } from '@/lib/auth/doctor';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearDoctorCookie(res);
  return res;
}
