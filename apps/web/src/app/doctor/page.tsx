import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DoctorDashboard } from '@/components/doctor/dashboard';
import { doctorDisplay, getDoctor, isDemoLoginAllowed } from '@/lib/auth/doctor';
import { ymdInTz } from '@/lib/time';
import { listDayForPractitioner, listUpcomingForPractitioner, toDoctorView } from '@/lib/visits/service';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DoctorHome() {
  const doctor = await getDoctor();
  if (!doctor) redirect('/doctor/login');
  const now = Date.now();
  const today = ymdInTz(now);
  const [visits, upcoming] = await Promise.all([
    listDayForPractitioner(doctor.practitioner, today),
    listUpcomingForPractitioner(doctor.practitioner, today),
  ]);
  return (
    <DoctorDashboard
      doctor={doctorDisplay(doctor.practitioner)}
      clinicName={doctor.clinic.name}
      initialVisits={visits.map((v) => toDoctorView(v, now))}
      initialUpcoming={upcoming.map((v) => toDoctorView(v, now))}
      demoMode={isDemoLoginAllowed()}
    />
  );
}
