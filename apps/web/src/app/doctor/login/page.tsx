import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/doctor/login-form';
import { Logo } from '@/components/logo';
import { getDoctor, isDemoLoginAllowed, isSupabaseAuth } from '@/lib/auth/doctor';


export const metadata: Metadata = { title: 'Physician sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith('/doctor') && !next.startsWith('//') ? next : '/doctor';
  if (await getDoctor()) redirect(safeNext);

  const demo = false; const demoAccounts: { email: string; label: string }[] = [];

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-brand-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="absolute -top-40 -right-40 size-[36rem] rounded-full bg-brand-600/40 blur-3xl" />
        <div aria-hidden className="absolute -bottom-48 -left-24 size-[28rem] rounded-full bg-brand-400/20 blur-3xl" />
        <Link href="/" className="relative">
          <Logo tone="light" />
        </Link>
        <div className="relative max-w-md">
          <p className="text-3xl leading-snug font-medium tracking-tight text-balance">
            Your waiting room, schedule and patient charts — together in one calm screen.
          </p>
          <p className="mt-4 text-brand-100/80">See who’s arrived, call them in, and have their history at your side throughout the visit.</p>
        </div>
        <p className="relative text-sm text-brand-100/60">Brevicor Telemedicine · Hosted in Canada</p>
      </div>

      {/* Form */}
      <div className="flex flex-col items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm animate-fade-in">
          <Link href="/" className="lg:hidden">
            <Logo />
          </Link>
          <h1 className="mt-8 text-2xl font-semibold tracking-tight lg:mt-0">Welcome back</h1>
          <p className="mt-1.5 text-slate-500">Sign in to your clinic’s virtual care workspace.</p>
          <LoginForm
            next={safeNext}
            demoAccounts={demoAccounts}
            demoPassword={undefined}
            unavailable={!demo && !isSupabaseAuth()}
          />
        </div>
      </div>
    </div>
  );
}
