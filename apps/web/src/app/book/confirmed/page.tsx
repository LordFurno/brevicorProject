import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { ArrowRight, CalendarPlus, Check, Clock, Mail, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import { CopyLink } from '@/components/copy-link';
import { Logo } from '@/components/logo';
import { Avatar, buttonClasses, Card } from '@/components/ui';
import { drName, getClinic, getPractitioner } from '@/lib/directory';
import { CLINIC_TZ_LABEL, formatDateLong, formatTime } from '@/lib/time';
import { getVisitStore } from '@/lib/visits/store';

export const metadata: Metadata = { title: 'Visit booked', robots: { index: false } };
export const dynamic = 'force-dynamic';

function icsDate(iso: string) {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export default async function ConfirmedPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const visit = t ? await getVisitStore().getByToken(t) : null;
  if (!visit) notFound();
  const practitioner = getPractitioner(visit.practitionerId)!;
  const clinic = getClinic(visit.clinicId)!;
  const firstName = visit.patient.name.split(' ')[0];
  const path = `/visit/${visit.inviteToken}`;

  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host') ?? 'localhost:3000'}`;
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Brevicor//Telemedicine//EN', 'BEGIN:VEVENT',
    `UID:${visit.id}@brevicor`, `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(visit.start)}`, `DTEND:${icsDate(visit.end)}`,
    `SUMMARY:Video visit with ${drName(practitioner)}`,
    `DESCRIPTION:Join your visit: ${origin}${path}`, `URL:${origin}${path}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-5xl items-center px-5 py-5">
        <Link href="/">
          <Logo />
        </Link>
      </header>
      <main className="mx-auto max-w-xl px-4 pb-16">
        <Card className="overflow-hidden animate-fade-in">
          <div className="bg-linear-to-b from-brand-50 to-white px-6 pt-10 pb-6 text-center sm:px-10">
            <span className="mx-auto grid size-14 place-items-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-900/20">
              <Check className="size-7" strokeWidth={2.5} />
            </span>
            <h1 className="mt-5 text-2xl font-semibold tracking-tight">You’re booked, {firstName}.</h1>
            <p className="mt-1.5 text-slate-600">We’ve saved your spot. Here’s everything you need.</p>
          </div>

          <div className="space-y-6 px-6 pb-8 sm:px-10">
            <div className="flex items-center gap-4 rounded-2xl border border-slate-200 p-4">
              <Avatar name={practitioner.name} color={practitioner.color} size="lg" />
              <div className="min-w-0">
                <p className="font-semibold">{drName(practitioner)}</p>
                <p className="text-sm text-slate-500">{practitioner.specialty} · {clinic.name}</p>
                <p className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-brand-700">
                  <Clock className="size-4" /> {formatDateLong(visit.start)} at {formatTime(visit.start)}
                  <span className="font-normal text-slate-400">{CLINIC_TZ_LABEL}</span>
                </p>
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">Your private visit link</p>
              <CopyLink path={path} />
              <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500">
                <Mail className="mt-px size-3.5 shrink-0" />
                We’ll also send this to {visit.patient.email ? 'your email' : 'your phone'}. Keep it private — it’s your key to the visit.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <a href={`data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`} download="brevicor-visit.ics" className={buttonClasses('secondary', 'md', 'flex-1')}>
                <CalendarPlus /> Add to calendar
              </a>
              <Link href={path} className={buttonClasses('primary', 'md', 'flex-1')}>
                Go to waiting room <ArrowRight />
              </Link>
            </div>

            <div className="rounded-2xl bg-slate-50 p-5">
              <p className="text-sm font-semibold">What happens next</p>
              <ol className="mt-3 space-y-3 text-sm text-slate-600 [&_svg]:size-4 [&_svg]:text-brand-600">
                <li className="flex gap-3"><MonitorSmartphone className="mt-0.5 shrink-0" />Open your link up to 15 minutes early on a phone or computer.</li>
                <li className="flex gap-3"><ShieldCheck className="mt-0.5 shrink-0" />Confirm your date of birth, then test your camera and microphone.</li>
                <li className="flex gap-3"><Clock className="mt-0.5 shrink-0" />Relax in the waiting room — your doctor will call you in.</li>
              </ol>
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}
