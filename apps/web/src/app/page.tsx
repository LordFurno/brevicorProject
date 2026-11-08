import Link from 'next/link';
import { Armchair, ArrowRight, CalendarCheck, Link2, ShieldCheck, Stethoscope, Video } from 'lucide-react';
import { Logo } from '@/components/logo';
import { buttonClasses } from '@/components/ui';

const steps = [
  { icon: CalendarCheck, title: 'Pick a time', text: 'Choose your clinic and doctor, then any open slot — just like booking a meeting.' },
  { icon: Link2, title: 'Get your private link', text: 'We send a secure link to your visit. No account, password or app.' },
  { icon: Armchair, title: 'Wait, then meet', text: 'Relax in the virtual waiting room. Your doctor calls you in when they’re ready.' },
];

export default function Home() {
  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-64 h-[44rem] bg-[radial-gradient(ellipse_at_center,rgba(42,156,129,0.16),transparent_62%)]"
      />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <Link href="/doctor/login" className={buttonClasses('ghost', 'sm')}>
          <Stethoscope /> Physician sign in
        </Link>
      </header>

      <main className="relative mx-auto max-w-6xl px-5 pt-12 pb-20 sm:pt-24">
        <div className="mx-auto max-w-2xl text-center animate-fade-in">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-200/70 bg-white/70 px-3 py-1 text-xs font-medium text-brand-700 backdrop-blur">
            <ShieldCheck className="size-3.5" /> Ontario clinics · Private &amp; secure · No app needed
          </span>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance text-slate-900 sm:text-6xl">
            Your doctor, <span className="text-brand-600">one link away.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-pretty text-slate-600">
            Book a video visit with your clinic in under a minute. Then wait comfortably in a virtual waiting room until your
            doctor calls you in.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/book" className={buttonClasses('primary', 'lg', 'w-full sm:w-auto')}>
              <Video /> Book a virtual visit <ArrowRight />
            </Link>
            <Link href="/doctor/login" className={buttonClasses('secondary', 'lg', 'w-full sm:w-auto')}>
              I’m a physician
            </Link>
          </div>
        </div>

        <ol className="mx-auto mt-24 grid max-w-4xl gap-4 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className="rounded-2xl border border-slate-200/70 bg-white/80 p-5 backdrop-blur animate-fade-in"
              style={{ animationDelay: `${120 + i * 90}ms` }}
            >
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-xl bg-brand-50 text-brand-700">
                  <s.icon className="size-[18px]" />
                </span>
                <span className="text-xs font-medium text-slate-400">Step {i + 1}</span>
              </div>
              <h3 className="mt-4 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{s.text}</p>
            </li>
          ))}
        </ol>
      </main>

      <footer className="relative border-t border-slate-200/70 py-6 text-center text-xs text-slate-400">
        Brevicor Telemedicine · Health information stays in Canada
      </footer>
    </div>
  );
}
