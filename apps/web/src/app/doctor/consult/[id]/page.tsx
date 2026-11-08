import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ConsultRoom } from '@/components/doctor/consult-room';
import { getDoctor, ownsVisit } from '@/lib/auth/doctor';
import { loadChart } from '@/lib/clinical';
import { visitViews } from '@/lib/visits/display';
import { getVisitStore } from '@/lib/visits/store';
export const metadata: Metadata = { title: 'Consultation' };
export const dynamic = 'force-dynamic';
export default async function ConsultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params,
    doctor = await getDoctor();
  if (!doctor) redirect('/doctor/login');
  const visit = await getVisitStore().get(doctor.clinicId, id);
  if (!visit || !ownsVisit(doctor, visit)) notFound();
  if (['completed', 'cancelled'].includes(visit.status)) redirect('/doctor');
  const ctx = { clinicId: doctor.clinicId, accessToken: doctor.accessToken },
    [view] = await visitViews([visit], ctx);
  const chart = await loadChart({
    ...ctx,
    patientRef: visit.patientRef,
    name: view.patientName,
    dateOfBirth: view.patientDateOfBirth,
  });
  return <ConsultRoom visit={view} chart={chart} clinicName={doctor.clinic.name} />;
}
