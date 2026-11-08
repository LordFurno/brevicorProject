import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ConsultRoom } from '@/components/doctor/consult-room';
import { getDoctor, ownsVisit } from '@/lib/auth/doctor';
import { getClinic } from '@/lib/directory';
import { loadChart } from '@/lib/clinical';
import { toDoctorView } from '@/lib/visits/service';
import { getVisitStore } from '@/lib/visits/store';

export const metadata: Metadata = { title: 'Consultation' };
export const dynamic = 'force-dynamic';

export default async function ConsultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doctor = await getDoctor();
  if (!doctor) redirect(`/doctor/login?next=/doctor/consult/${id}`);

  const visit = await getVisitStore().get(id);
  if (!visit || !ownsVisit(doctor, visit)) notFound();
  if (visit.status === 'completed' || visit.status === 'cancelled') redirect('/doctor');

  // Chart is fetched server-side through the clinical data seam (mock or FHIR gateway).
  const chart = await loadChart({
    clinicId: visit.clinicId,
    name: visit.patient.name,
    dateOfBirth: visit.patient.dateOfBirth,
    healthCardNumber: visit.patient.healthCardNumber,
  });

  return <ConsultRoom visit={toDoctorView(visit)} chart={chart} clinicName={getClinic(visit.clinicId)?.name ?? ''} />;
}
