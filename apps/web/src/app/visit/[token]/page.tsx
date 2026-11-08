import type { Metadata } from 'next';
import Link from 'next/link';
import { Link2Off } from 'lucide-react';
import { Logo } from '@/components/logo';
import { buttonClasses } from '@/components/ui';
import { VisitFlow } from '@/components/visit/visit-flow';
import { isPatientVerified } from '@/lib/auth/patient';
import { drName, drShort, getClinic, getPractitioner } from '@/lib/directory';
import { getVisitStore } from '@/lib/visits/store';

export const metadata: Metadata = { title: 'Your visit', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function VisitPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const visit = await getVisitStore().getByToken(token);
  const practitioner = visit && getPractitioner(visit.practitionerId);
  const clinic = visit && getClinic(visit.clinicId);

  if (!visit || !practitioner || !clinic) {
    return (
      <div className="grid min-h-dvh place-items-center px-5">
        <div className="max-w-sm text-center animate-fade-in">
          <Logo className="justify-center" />
          <span className="mx-auto mt-10 grid size-14 place-items-center rounded-full bg-slate-100 text-slate-500">
            <Link2Off className="size-6" />
          </span>
          <h1 className="mt-5 text-xl font-semibold">This link doesn’t work</h1>
          <p className="mt-2 text-sm text-slate-600">
            It may have been mistyped or the visit was cancelled. Check the message from your clinic, or book a new visit.
          </p>
          <Link href="/book" className={buttonClasses('primary', 'md', 'mt-6')}>
            Book a visit
          </Link>
        </div>
      </div>
    );
  }

  return (
    <VisitFlow
      token={token}
      doctor={{ name: drName(practitioner), short: drShort(practitioner), specialty: practitioner.specialty, color: practitioner.color }}
      clinicName={clinic.name}
      start={visit.start}
      initiallyVerified={await isPatientVerified(visit.id)}
    />
  );
}
