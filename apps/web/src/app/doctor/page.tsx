import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DoctorDashboard } from '@/components/doctor/dashboard';
import { doctorDisplay, getDoctor, isDemoLoginAllowed } from '@/lib/auth/doctor';
import { toScheduleView } from '@/scheduling/doctor-view';
import { loadDoctorSchedule } from '@/scheduling/doctor-schedule';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DoctorHome() {
  const doctor = await getDoctor();
  if (!doctor) redirect('/doctor/login');
  const now = Date.now();
  const { visits, upcoming } = await loadDoctorSchedule(doctor.practitioner, now);
  return (
    <DoctorDashboard
      doctor={doctorDisplay(doctor.practitioner)}
      clinicName={doctor.clinic.name}
      initialVisits={visits.map((v) => toScheduleView(v, now))}
      initialUpcoming={upcoming.map((v) => toScheduleView(v, now))}
      demoMode={isDemoLoginAllowed()}
    />
  );
}
