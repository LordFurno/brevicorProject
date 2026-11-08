import type { Metadata } from 'next';
import { VisitFlow } from '@/components/visit/visit-flow';
import { Logo } from '@/components/logo';
import { isPatientVerified } from '@/lib/auth/patient';
import { practitionerDisplay } from '@/lib/clinical/gateway';
import { adminClient } from '@/lib/supabase/admin';
import { getVisitStore } from '@/lib/visits/store';
export const metadata: Metadata = { title: 'Your visit', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export default async function VisitPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params,
    visit = await getVisitStore().getByToken(token);
  if (!visit)
    return (
      <main className="mx-auto max-w-sm px-5 py-20 text-center">
        <Logo />
        <h1 className="mt-8 text-xl font-semibold">This link doesn’t work</h1>
        <p className="mt-3">Please contact your clinic for a new visit link.</p>
      </main>
    );
  const [doctor, clinic] = await Promise.all([
    practitionerDisplay(visit.practitionerRef, { clinicId: visit.clinicId }).catch(() => ({
      name: 'Your physician',
      short: 'your physician',
      specialty: 'Physician',
      color: 'brand',
    })),
    adminClient()
      .from('ehr_connections')
      .select('display_name')
      .eq('clinic_id', visit.clinicId)
      .single(),
  ]);
  return (
    <VisitFlow
      token={token}
      modality={visit.modality}
      doctor={doctor}
      clinicName={clinic.data?.display_name ?? 'Brevicor'}
      start={visit.start}
      initiallyVerified={await isPatientVerified(visit)}
    />
  );
}
