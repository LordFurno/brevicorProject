'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarCheck,
  ChevronRight,
  Clock,
  Globe,
  Languages,
  Lock,
  MapPin,
  TriangleAlert,
  Video,
} from 'lucide-react';
import { Logo } from '@/components/logo';
import { Alert, Avatar, Button, Card, Field, Input, Textarea } from '@/components/ui';
import type { PublicClinic } from '@/lib/directory';
import { addMonths, CLINIC_TZ_LABEL, formatDateLong, formatTime, formatYmd } from '@/lib/time';
import { MonthCalendar } from './month-calendar';

type Step = 'clinic' | 'doctor' | 'time' | 'details';
const STEPS: Step[] = ['clinic', 'doctor', 'time', 'details'];
const TITLES: Record<Step, [string, string]> = {
  clinic: ['Where are you a patient?', 'Choose the clinic that has your health records.'],
  doctor: ['Who would you like to see?', 'Pick your physician or anyone available.'],
  time: ['Select a date & time', `All times are in ${CLINIC_TZ_LABEL}.`],
  details: ['Your details', 'This is how your clinic confirms who you are. No account needed.'],
};

const emptyForm = { name: '', dateOfBirth: '', healthCardNumber: '', email: '', phone: '', reason: '', consent: false };

export function BookingWizard({ directory, today }: { directory: PublicClinic[]; today: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('clinic');
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [practitionerId, setPractitionerId] = useState<string | null>(null);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [days, setDays] = useState<Record<string, string[]> | null>(null);
  const [loadingDays, setLoadingDays] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clinic = directory.find((c) => c.id === clinicId) ?? null;
  const practitioner = clinic?.practitioners.find((p) => p.id === practitionerId) ?? null;
  const available = useMemo(() => new Set(Object.keys(days ?? {})), [days]);
  const daySlots = (day && days?.[day]) || [];

  useEffect(() => {
    if (!practitionerId) return;
    let cancelled = false;
    setLoadingDays(true);
    fetch(`/api/availability?practitionerId=${encodeURIComponent(practitionerId)}&month=${month}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('availability'))))
      .then((d: { days: Record<string, string[]> }) => {
        if (cancelled) return;
        setDays(d.days);
        setDay((current) => (current && d.days[current] ? current : (Object.keys(d.days).sort()[0] ?? null)));
      })
      .catch(() => !cancelled && setDays({}))
      .finally(() => !cancelled && setLoadingDays(false));
    return () => {
      cancelled = true;
    };
  }, [practitionerId, month, refresh]);

  const go = (s: Step) => {
    setError(null);
    setStep(s);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const back = () => go(STEPS[Math.max(0, STEPS.indexOf(step) - 1)]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.email && !form.phone) {
      setError('Add an email or mobile number so we can send your visit link.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          practitionerId,
          start: slot,
          reason: form.reason,
          consent: form.consent,
          patient: {
            name: form.name,
            dateOfBirth: form.dateOfBirth,
            healthCardNumber: form.healthCardNumber,
            email: form.email,
            phone: form.phone,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setSlot(null);
        setRefresh((n) => n + 1);
        go('time');
        setError(data.error ?? 'That time was just taken.');
        setSubmitting(false);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong. Please try again.');
      router.push(`/book/confirmed?t=${encodeURIComponent(data.token)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  const stepIndex = STEPS.indexOf(step);
  const [title, subtitle] = TITLES[step];

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <Link href="/" aria-label="Brevicor home">
          <Logo />
        </Link>
        <span className="flex items-center gap-1.5 text-xs text-slate-500 sm:text-sm">
          <Lock className="size-3.5" /> No account needed
        </span>
      </header>

      <main className="mx-auto max-w-5xl px-3 pb-16 sm:px-5">
        <Card className="overflow-hidden animate-fade-in md:grid md:grid-cols-[300px_minmax(0,1fr)]">
          {/* Summary panel */}
          <aside className="border-b border-slate-100 bg-slate-50/70 p-6 md:border-r md:border-b-0 md:p-7">
            <p className="text-xs font-medium tracking-wider text-slate-400 uppercase">Video visit</p>
            {practitioner ? (
              <div className="mt-3 flex items-center gap-3">
                <Avatar name={practitioner.name} color={practitioner.color} />
                <div>
                  <h2 className="font-semibold leading-tight">Dr. {practitioner.name}</h2>
                  <p className="text-sm text-slate-500">{practitioner.specialty}</p>
                </div>
              </div>
            ) : (
              <h2 className="mt-2 text-xl font-semibold tracking-tight">{clinic?.name ?? 'Book a virtual visit'}</h2>
            )}

            <ul className="mt-6 space-y-3 text-sm text-slate-600 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-slate-400">
              <SummaryItem icon={<Clock />}>{practitioner?.slotMinutes ?? 20} minutes</SummaryItem>
              <SummaryItem icon={<Video />}>Secure video, right in your browser</SummaryItem>
              {clinic && <SummaryItem icon={<Building2 />}>{clinic.name}</SummaryItem>}
              {slot && (
                <SummaryItem icon={<CalendarCheck className="text-brand-600!" />} className="font-medium text-brand-700">
                  {formatTime(slot)}, {formatDateLong(slot)}
                </SummaryItem>
              )}
              <SummaryItem icon={<Globe />}>{CLINIC_TZ_LABEL} (Toronto)</SummaryItem>
            </ul>

            <div className="mt-8 flex gap-1.5" aria-hidden>
              {STEPS.map((s, i) => (
                <span key={s} className={clsx('h-1 flex-1 rounded-full transition-colors', i <= stepIndex ? 'bg-brand-500' : 'bg-slate-200')} />
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Step {stepIndex + 1} of {STEPS.length}
            </p>
          </aside>

          {/* Step content */}
          <section className="min-h-[540px] p-6 sm:p-8">
            <div className="mb-6 flex items-start gap-3">
              {stepIndex > 0 && (
                <button
                  type="button"
                  onClick={back}
                  aria-label="Back"
                  className="-ml-1 grid size-9 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-600 transition hover:bg-slate-50"
                >
                  <ArrowLeft className="size-4" />
                </button>
              )}
              <div>
                <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
                <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
              </div>
            </div>

            {error && step !== 'details' && (
              <Alert className="mb-5">
                <TriangleAlert /> {error}
              </Alert>
            )}

            <div key={step} className="animate-fade-in">
              {step === 'clinic' && (
                <div className="grid gap-3">
                  {directory.map((c) => (
                    <ChoiceButton
                      key={c.id}
                      selected={c.id === clinicId}
                      onClick={() => {
                        if (c.id !== clinicId) {
                          setPractitionerId(null);
                          setDays(null);
                          setDay(null);
                          setSlot(null);
                        }
                        setClinicId(c.id);
                        go('doctor');
                      }}
                      leading={
                        <span className="grid size-11 place-items-center rounded-xl bg-slate-100 text-slate-500 transition group-hover:bg-brand-100 group-hover:text-brand-700">
                          <Building2 className="size-5" />
                        </span>
                      }
                      title={c.name}
                      subtitle={
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3.5" /> {c.address}
                        </span>
                      }
                    />
                  ))}
                </div>
              )}

              {step === 'doctor' && clinic && (
                <div className="grid gap-3">
                  {clinic.practitioners.map((p) => (
                    <ChoiceButton
                      key={p.id}
                      selected={p.id === practitionerId}
                      onClick={() => {
                        if (p.id !== practitionerId) {
                          setDays(null);
                          setDay(null);
                          setSlot(null);
                          setMonth(today.slice(0, 7));
                        }
                        setPractitionerId(p.id);
                        go('time');
                      }}
                      leading={<Avatar name={p.name} color={p.color} size="lg" />}
                      title={`Dr. ${p.name}`}
                      subtitle={
                        <>
                          <span className="block">{p.specialty}</span>
                          <span className="mt-1 block text-slate-500">{p.bio}</span>
                          <span className="mt-2 inline-flex items-center gap-1 text-xs text-slate-400">
                            <Languages className="size-3.5" /> {p.languages.join(' · ')}
                          </span>
                        </>
                      }
                    />
                  ))}
                </div>
              )}

              {step === 'time' && practitioner && (
                <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_200px]">
                  <MonthCalendar
                    month={month}
                    today={today}
                    available={available}
                    selected={day}
                    loading={loadingDays}
                    canPrev={month > today.slice(0, 7)}
                    onPrev={() => setMonth((m) => addMonths(m, -1))}
                    onNext={() => setMonth((m) => addMonths(m, 1))}
                    onSelect={(d) => {
                      setDay(d);
                      setSlot(null);
                    }}
                  />
                  <div>
                    <p className="mb-3 text-sm font-medium text-slate-700">
                      {day ? formatYmd(day, { weekday: 'long', month: 'long', day: 'numeric' }) : 'Pick a day'}
                    </p>
                    {!loadingDays && days && Object.keys(days).length === 0 && (
                      <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No openings this month. Try the next one.</p>
                    )}
                    <div className="scroll-thin grid max-h-[340px] grid-cols-2 gap-2 overflow-y-auto pr-1 lg:grid-cols-1">
                      {daySlots.map((s) =>
                        slot === s ? (
                          <div key={s} className="col-span-2 grid grid-cols-2 gap-2 lg:col-span-1">
                            <span className="grid h-11 place-items-center rounded-xl bg-slate-700 text-sm font-medium text-white">{formatTime(s)}</span>
                            <Button className="h-11" onClick={() => go('details')}>
                              Next
                            </Button>
                          </div>
                        ) : (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setSlot(s)}
                            className="h-11 rounded-xl border border-brand-200 text-sm font-semibold text-brand-700 transition hover:border-brand-500 hover:bg-brand-50"
                          >
                            {formatTime(s)}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                </div>
              )}

              {step === 'details' && slot && (
                <form onSubmit={submit} className="grid gap-5 sm:grid-cols-2">
                  <Field label="Full name" htmlFor="name" className="sm:col-span-2">
                    <Input id="name" autoComplete="name" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="As it appears on your health card" />
                  </Field>
                  <Field label="Date of birth" htmlFor="dob" hint="You’ll confirm this to enter your visit.">
                    <Input id="dob" type="date" autoComplete="bday" required max={today} value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
                  </Field>
                  <Field label="Ontario health card" htmlFor="hcn" optional hint="Helps your clinic find your chart.">
                    <Input id="hcn" inputMode="numeric" value={form.healthCardNumber} onChange={(e) => set('healthCardNumber', e.target.value)} placeholder="1234-567-890" />
                  </Field>
                  <Field label="Email" htmlFor="email">
                    <Input id="email" type="email" autoComplete="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="you@example.com" />
                  </Field>
                  <Field label="Mobile number" htmlFor="phone">
                    <Input id="phone" type="tel" autoComplete="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="(416) 555-0123" />
                  </Field>
                  <p className="-mt-3 text-xs text-slate-500 sm:col-span-2">We’ll send your private visit link to your email or phone — at least one is needed.</p>
                  <Field
                    label="What would you like to discuss?"
                    htmlFor="reason"
                    className="sm:col-span-2"
                    hint={<span className="flex justify-between"><span>Shared only with your doctor.</span><span>{form.reason.length}/500</span></span>}
                  >
                    <Textarea id="reason" required maxLength={500} value={form.reason} onChange={(e) => set('reason', e.target.value)} placeholder="e.g. A cough that hasn’t gone away for two weeks" />
                  </Field>
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4 text-sm text-slate-600 sm:col-span-2">
                    <input
                      type="checkbox"
                      required
                      checked={form.consent}
                      onChange={(e) => set('consent', e.target.checked)}
                      className="mt-0.5 size-4 shrink-0 rounded accent-brand-600"
                    />
                    <span>
                      I consent to receiving care by video. I understand my clinic will use my information to find my health record, and that
                      it stays in Canada in line with Ontario’s PHIPA.
                    </span>
                  </label>
                  {error && (
                    <Alert className="sm:col-span-2">
                      <TriangleAlert /> {error}
                    </Alert>
                  )}
                  <div className="flex flex-col-reverse gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-slate-500">
                      {formatTime(slot)} · {formatDateLong(slot)}
                    </p>
                    <Button type="submit" size="lg" loading={submitting}>
                      Confirm booking <ArrowRight />
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </section>
        </Card>
      </main>
    </div>
  );
}

function SummaryItem({ icon, children, className }: { icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <li className={clsx('flex items-start gap-2.5', className)}>
      <span className="mt-0.5">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

function ChoiceButton({
  leading,
  title,
  subtitle,
  selected,
  onClick,
}: {
  leading: ReactNode;
  title: string;
  subtitle: ReactNode;
  selected?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'group flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition',
        selected ? 'border-brand-400 bg-brand-50/50 ring-4 ring-brand-500/10' : 'border-slate-200 hover:border-brand-300 hover:bg-brand-50/30',
      )}
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-slate-900">{title}</span>
        <span className="mt-0.5 block text-sm text-slate-600">{subtitle}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600" />
    </button>
  );
}
