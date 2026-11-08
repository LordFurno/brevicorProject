import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import { patientCookieName } from './constants';
import { cookieOptions, sign, verifySigned } from './signing';

// Patients have no accounts. After they prove they hold the invite link AND
// know the date of birth on file, they get a short-lived cookie scoped to
// that single visit.

const TTL_SECONDS = 6 * 3600;

export function setPatientCookie(res: NextResponse, visitId: string) {
  const token = sign({ vid: visitId, exp: Date.now() + TTL_SECONDS * 1000 });
  res.cookies.set(patientCookieName(visitId), token, cookieOptions(TTL_SECONDS));
}

export async function isPatientVerified(visitId: string): Promise<boolean> {
  const raw = (await cookies()).get(patientCookieName(visitId))?.value;
  const payload = verifySigned<{ vid: string; exp: number }>(raw);
  return !!payload && payload.vid === visitId;
}
