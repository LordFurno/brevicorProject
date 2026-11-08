import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  DEMO_PASSWORD,
  drName,
  drShort,
  findPractitionerByEmail,
  getClinic,
  getPractitioner,
  type Clinic,
  type Practitioner,
} from '@/lib/directory';
import { isDemoEnvironment } from '@/lib/demo';
import type { Visit } from '@/lib/visits/types';
import { DOCTOR_COOKIE } from './constants';
import { cookieOptions, sign, verifySigned } from './signing';

const TTL_SECONDS = 12 * 3600;

export interface DoctorSession {
  practitioner: Practitioner;
  clinic: Clinic;
}

export const isSupabaseAuth = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
export const isDemoLoginAllowed = () => !isSupabaseAuth() && isDemoEnvironment();

/** Returns the practitioner on success. */
export async function authenticate(email: string, password: string): Promise<Practitioner | null> {
  const practitioner = findPractitionerByEmail(email);
  if (isSupabaseAuth()) {
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.user) return null;
    // Map the Supabase user to a practitioner by email. Later: by FHIR Practitioner id in user metadata.
    return practitioner ?? null;
  }
  if (!isDemoLoginAllowed()) return null;
  return practitioner && password === DEMO_PASSWORD ? practitioner : null;
}

export function setDoctorCookie(res: NextResponse, p: Practitioner) {
  const token = sign({ pid: p.id, cid: p.clinicId, exp: Date.now() + TTL_SECONDS * 1000 });
  res.cookies.set(DOCTOR_COOKIE, token, cookieOptions(TTL_SECONDS));
}

export function clearDoctorCookie(res: NextResponse) {
  res.cookies.set(DOCTOR_COOKIE, '', cookieOptions(0));
}

export async function getDoctor(): Promise<DoctorSession | null> {
  const raw = (await cookies()).get(DOCTOR_COOKIE)?.value;
  const payload = verifySigned<{ pid: string; cid: string; exp: number }>(raw);
  if (!payload) return null;
  const practitioner = getPractitioner(payload.pid);
  const clinic = practitioner && getClinic(practitioner.clinicId);
  if (!practitioner || !clinic || clinic.id !== payload.cid) return null;
  return { practitioner, clinic };
}

/** Tenant + ownership check for every physician action on a visit. */
export const ownsVisit = (d: DoctorSession, v: Visit) =>
  v.clinicId === d.clinic.id && v.practitionerId === d.practitioner.id;

export const doctorDisplay = (p: Practitioner) => ({
  name: drName(p),
  short: drShort(p),
  specialty: p.specialty,
  color: p.color,
});
