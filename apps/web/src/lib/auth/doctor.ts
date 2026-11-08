import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import type { NextResponse } from 'next/server';
import { sessionClient } from '@/lib/supabase/session';
import { adminClient } from '@/lib/supabase/admin';
import { practitionerDisplay } from '@/lib/clinical/gateway';
import type { Visit } from '@/lib/visits/types';
import { cookieOptions } from './signing';
export const CLINIC_COOKIE = 'brv_clinic';
export interface PhysicianMembership {
  clinicId: string;
  practitionerRef: string;
  name: string;
}
export interface DoctorSession {
  userId: string;
  clinicId: string;
  practitionerRef: string;
  accessToken: string;
  memberships: PhysicianMembership[];
  practitioner: Awaited<ReturnType<typeof practitionerDisplay>>;
  clinic: { id: string; name: string };
}
export const isSupabaseAuth = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
export const isDemoLoginAllowed = () => false;
export async function authenticate(email: string, password: string) {
  const client = await sessionClient();
  const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error || !data.user) return false;
  const { data: members } = await client
    .from('clinic_members')
    .select('clinic_id')
    .eq('user_id', data.user.id)
    .eq('role', 'physician');
  if (!members?.length) {
    await client.auth.signOut();
    return false;
  }
  return true;
}
export const getDoctor = cache(async (): Promise<DoctorSession | null> => {
  if (!isSupabaseAuth()) return null;
  const client = await sessionClient(),
    {
      data: { user },
      error,
    } = await client.auth.getUser();
  if (error || !user) return null;
  const { data: rows, error: membershipError } = await client
    .from('clinic_members')
    .select('clinic_id,practitioner_ref')
    .eq('user_id', user.id)
    .eq('role', 'physician');
  if (membershipError) throw new Error('Clinic membership unavailable');
  if (!rows?.length) return null;
  const memberships: PhysicianMembership[] = await Promise.all(
    rows
      .filter((r) => r.practitioner_ref)
      .map(async (r) => {
        const { data, error } = await adminClient()
          .from('ehr_connections')
          .select('display_name')
          .eq('clinic_id', r.clinic_id)
          .single();
        if (error) throw new Error('Clinic unavailable');
        return {
          clinicId: r.clinic_id as string,
          practitionerRef: r.practitioner_ref as string,
          name: (data.display_name as string | null) ?? 'Brevicor',
        };
      }),
  );
  if (!memberships.length) return null;
  const selected = (await cookies()).get(CLINIC_COOKIE)?.value;
  const membership =
    memberships.find((m) => m.clinicId === selected) ??
    memberships.find((m) => m.clinicId === 'demo-mock') ??
    memberships[0];
  const {
    data: { session },
  } = await client.auth.getSession();
  if (!session) return null;
  const ctx = { clinicId: membership.clinicId, accessToken: session.access_token };
  const practitioner = await practitionerDisplay(membership.practitionerRef, ctx).catch(() => ({
    id: membership.practitionerRef.split('/')[1],
    ref: membership.practitionerRef,
    clinicId: membership.clinicId,
    name: 'Physician',
    short: 'Doctor',
    specialty: 'Physician',
    color: 'brand',
  }));
  return {
    userId: user.id,
    clinicId: membership.clinicId,
    practitionerRef: membership.practitionerRef,
    accessToken: session.access_token,
    memberships,
    practitioner,
    clinic: { id: membership.clinicId, name: membership.name },
  };
});
export const ownsVisit = (d: DoctorSession, v: Visit) =>
  v.clinicId === d.clinicId && v.practitionerRef === d.practitionerRef;
export const doctorDisplay = (p: DoctorSession['practitioner']) => ({
  name: p.name,
  short: p.short,
  specialty: p.specialty,
  color: p.color,
});
export function clearDoctorCookie(res: NextResponse) {
  res.cookies.set(CLINIC_COOKIE, '', cookieOptions(0));
}
