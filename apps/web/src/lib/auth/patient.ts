import 'server-only';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import type { Visit } from '@/lib/visits/types';
import { getVisitStore } from '@/lib/visits/store';
import { hashToken, tokenClinic } from '@/lib/visits/tokens';
import { patientCookieName } from './constants';
import { cookieOptions, sign, verifySigned } from './signing';
const TTL = 6 * 3600;
type Credential = {
  vid: string;
  cid: string;
  hash: string;
  patientRef: string;
  admittedAt?: string;
  exp: number;
};
const callCookie = (token: string) => `brv_call_${hashToken(token).slice(0, 24)}`;
export function setPatientCookie(res: NextResponse, v: Visit) {
  res.cookies.set(
    patientCookieName(v.id),
    sign({ vid: v.id, cid: v.clinicId, hash: v.inviteTokenHash, exp: Date.now() + TTL * 1000 }),
    cookieOptions(TTL),
  );
}
export async function isPatientVerified(v: Visit) {
  const p = verifySigned<Credential>((await cookies()).get(patientCookieName(v.id))?.value);
  return !!p && p.vid === v.id && p.cid === v.clinicId && p.hash === v.inviteTokenHash;
}
export function setCallCookie(res: NextResponse, v: Visit, token: string) {
  res.cookies.set(
    callCookie(token),
    sign({
      vid: v.id,
      cid: v.clinicId,
      hash: hashToken(token),
      patientRef: v.patientRef,
      admittedAt: v.admittedAt,
      exp: Date.now() + TTL * 1000,
    }),
    cookieOptions(TTL),
  );
}
/** A rotated invitation cannot bootstrap a new session. An already joined call
 * keeps a separate, signed capability for status/photos until that call ends. */
export async function authorizedPatient(token: string, allowCall = false): Promise<Visit | null> {
  if (allowCall) {
    const p = verifySigned<Credential>((await cookies()).get(callCookie(token))?.value);
    if (p && p.cid === tokenClinic(token) && p.hash === hashToken(token)) {
      const v = await getVisitStore().get(p.cid, p.vid);
      if (
        v &&
        v.patientRef === p.patientRef &&
        v.admittedAt === p.admittedAt &&
        ['in_progress', 'completed'].includes(v.status)
      )
        return v;
    }
  }
  const v = await getVisitStore().getByToken(token);
  return v && (await isPatientVerified(v)) ? v : null;
}
