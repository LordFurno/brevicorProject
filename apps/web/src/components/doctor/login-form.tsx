'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ArrowRight, FlaskConical, TriangleAlert } from 'lucide-react';
import { Alert, Button, Field, Input } from '@/components/ui';

export function LoginForm({
  next,
  demoAccounts,
  demoPassword,
  unavailable,
}: {
  next: string;
  demoAccounts: { email: string; label: string }[];
  demoPassword?: string;
  unavailable?: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e?: FormEvent, override?: { email: string; password: string }) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(override ?? { email, password }),
    }).catch(() => null);
    if (res?.ok) {
      router.replace(next);
      router.refresh();
      return;
    }
    const data = res ? await res.json().catch(() => ({})) : {};
    setError(data.error ?? 'Couldn’t sign in. Please try again.');
    setBusy(false);
  }

  return (
    <>
      <form onSubmit={signIn} className="mt-8 space-y-4">
        {/* Browser autofill diagnostics add attributes before hydration. Scope the escape hatch to these two inputs. */}
        <Field label="Work email" htmlFor="email">
          <Input suppressHydrationWarning id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@clinic.ca" />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input suppressHydrationWarning id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {unavailable && (
          <Alert tone="amber">
            <TriangleAlert /> Sign-in isn’t configured on this server yet. Set SUPABASE_URL and SUPABASE_ANON_KEY.
          </Alert>
        )}
        {error && (
          <Alert>
            <TriangleAlert /> {error}
          </Alert>
        )}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Sign in <ArrowRight />
        </Button>
      </form>

      {demoPassword && demoAccounts.length > 0 && (
        <div className="mt-8 rounded-2xl border border-dashed border-slate-300 p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            <FlaskConical className="size-3.5" /> Demo accounts
          </p>
          <div className="mt-3 space-y-1.5">
            {demoAccounts.slice(0, 3).map((a) => (
              <button
                key={a.email}
                type="button"
                disabled={busy}
                onClick={() => signIn(undefined, { email: a.email, password: demoPassword })}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-slate-100"
              >
                <span className="truncate text-slate-700">{a.label}</span>
                <ArrowRight className="size-3.5 shrink-0 text-slate-400" />
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Password for all demo accounts: <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-600">{demoPassword}</code>
          </p>
        </div>
      )}
    </>
  );
}
