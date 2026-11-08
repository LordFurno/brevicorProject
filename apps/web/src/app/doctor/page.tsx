import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DoctorDashboard } from '@/components/doctor/dashboard';
import { doctorDisplay, getDoctor, isDemoLoginAllowed } from '@/lib/auth/doctor';
import { loadDoctorSchedule } from '@/scheduling/doctor-schedule';
import { after } from 'next/server';
import { syncVisits } from '@/lib/visits/sync';
import { visitViews } from '@/lib/visits/display';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DoctorHome() {
  const doctor = await getDoctor();
  if (!doctor) redirect('/doctor/login');
  const now = Date.now();
  let syncError = '';
  try {
    await syncVisits(doctor.clinicId, undefined, { dispatch: (job) => after(job) });
  } catch {
    syncError = 'Appointments could not sync. Previously saved visits are shown. Please retry.';
  }
  const { visits, upcoming } = await loadDoctorSchedule(doctor.practitioner, now);
  const ctx = { clinicId: doctor.clinicId, accessToken: doctor.accessToken };
  const [views, upcomingViews] = await Promise.all([
    visitViews(visits, ctx, now),
    visitViews(upcoming, ctx, now),
  ]);
  return (
    <DoctorDashboard
      doctor={doctorDisplay(doctor.practitioner)}
      clinicName={doctor.clinic.name}
      initialVisits={views}
      initialUpcoming={upcomingViews}
      clinics={doctor.memberships.map((m) => ({ id: m.clinicId, name: m.name }))}
      clinicId={doctor.clinicId}
      syncError={syncError}
      demoMode={isDemoLoginAllowed()}
    />
  );
}
