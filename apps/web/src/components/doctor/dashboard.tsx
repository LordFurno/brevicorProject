'use client';

import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Armchair,
  ArrowRight,
  Bell,
  BellRing,
  CalendarDays,
  Check,
  CircleCheck,
  Hourglass,
  Link2,
  LogOut,
  RotateCcw,
  Users,
  Video,
} from 'lucide-react';
import { Logo } from '@/components/logo';
import { Avatar, Badge, Button, Card } from '@/components/ui';
import { useNow } from '@/components/use-now';
import { formatDateLong, formatDateShort, formatTime, formatWait, minutesInTz } from '@/lib/time';
import type { DoctorVisitView } from '@/lib/visits/types';

interface DoctorInfo {
  name: string;
  short: string;
  specialty: string;
  color: string;
}

function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1318.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime + i * 0.18;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.65);
    });
    setTimeout(() => void ctx.close(), 1200);
  } catch {
    /* audio blocked until first interaction — fine */
  }
}

export function DoctorDashboard({
  doctor,
  clinicName,
  initialVisits,
  initialUpcoming,
  demoMode,
}: {
  doctor: DoctorInfo;
  clinicName: string;
  initialVisits: DoctorVisitView[];
  initialUpcoming: DoctorVisitView[];
  demoMode: boolean;
}) {
  const router = useRouter();
  const now = useNow(15_000);
  const [visits, setVisits] = useState(initialVisits);
  const [upcoming, setUpcoming] = useState(initialUpcoming);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const known = useRef(new Set([...initialVisits, ...initialUpcoming].map((v) => v.id)));
  const [admitting, setAdmitting] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<NotificationPermission | 'unsupported'>('default');
  const seen = useRef(new Set(initialVisits.filter((v) => v.present).map((v) => v.id)));

  useEffect(() => {
    setAlerts(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  }, []);

  // Live waiting room (polling keeps it provider-agnostic; swap for Supabase Realtime later).
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      const r = await fetch('/api/doctor/visits', { cache: 'no-store' }).catch(() => null);
      if (!r || stopped) return;
      if (r.status === 401) return router.replace('/doctor/login');
      if (!r.ok) return;
      const { visits: next, upcoming: nextUpcoming } = (await r.json()) as { visits: DoctorVisitView[]; upcoming: DoctorVisitView[] };
      if (stopped) return;
      setVisits(next);
      setUpcoming(nextUpcoming);
      // Highlight bookings that arrived since the page loaded.
      const added = [...next, ...nextUpcoming].filter((v) => !known.current.has(v.id)).map((v) => v.id);
      if (added.length) {
        added.forEach((id) => known.current.add(id));
        setFresh((f) => new Set([...f, ...added]));
      }
      const arrived = next.filter((v) => v.present && !seen.current.has(v.id));
      if (arrived.length) {
        chime();
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
          // No patient-identifying info in notifications.
          new Notification('A patient has arrived', { body: 'Someone is waiting in your virtual waiting room.', tag: 'brevicor-arrival' });
        }
      }
      seen.current = new Set(next.filter((v) => v.present).map((v) => v.id));
    };
    const id = setInterval(load, 3000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [router]);

  const waiting = useMemo(
    () => visits.filter((v) => v.status === 'waiting').sort((a, b) => Number(b.present) - Number(a.present) || a.start.localeCompare(b.start)),
    [visits],
  );
  const presentCount = waiting.filter((v) => v.present).length;
  const inProgress = visits.find((v) => v.status === 'in_progress');
  const completed = visits.filter((v) => v.status === 'completed').length;
  const longestWait = waiting.filter((v) => v.present && v.waitingSince).reduce((m, v) => Math.max(m, now - Date.parse(v.waitingSince!)), 0);

  useEffect(() => {
    document.title = presentCount ? `(${presentCount}) Waiting room · Brevicor` : 'Dashboard · Brevicor';
  }, [presentCount]);

  const hour = Math.floor(minutesInTz(now) / 60);
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  async function callIn(id: string) {
    setAdmitting(id);
    const r = await fetch(`/api/doctor/visits/${id}/admit`, { method: 'POST' }).catch(() => null);
    if (r?.ok) router.push(`/doctor/consult/${id}`);
    else setAdmitting(null);
  }

  async function copyLink(v: DoctorVisitView) {
    await navigator.clipboard.writeText(`${window.location.origin}${v.invitationPath}`);
    setCopied(v.id);
    setTimeout(() => setCopied((c) => (c === v.id ? null : c)), 1800);
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/doctor/login');
    router.refresh();
  }

  async function resetDemo() {
    await fetch('/api/dev/reset', { method: 'POST' });
    window.location.reload();
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <Logo />
            <span className="hidden h-5 w-px bg-slate-200 sm:block" />
            <span className="hidden truncate text-sm text-slate-500 sm:block">{clinicName}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm leading-tight font-medium">{doctor.name}</p>
              <p className="text-xs text-slate-500">{doctor.specialty}</p>
            </div>
            <Avatar name={doctor.name} color={doctor.color} />
            <Button variant="ghost" size="sm" onClick={signOut} aria-label="Sign out" title="Sign out">
              <LogOut />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4 animate-fade-in">
          <div>
            <p className="text-sm text-slate-500" suppressHydrationWarning>{formatDateLong(now)}</p>
            <h1 className="mt-0.5 text-2xl font-semibold tracking-tight sm:text-3xl" suppressHydrationWarning>
              {greeting}, {doctor.short}
            </h1>
          </div>
          {alerts === 'default' && (
            <Button variant="secondary" size="sm" onClick={async () => setAlerts(await Notification.requestPermission())}>
              <Bell /> Enable arrival alerts
            </Button>
          )}
          {alerts === 'granted' && (
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <BellRing className="size-3.5 text-brand-600" /> Arrival alerts on
            </span>
          )}
        </div>

        {inProgress && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-900 px-5 py-4 text-white animate-fade-in">
            <div className="flex items-center gap-3">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full bg-rose-500" />
              </span>
              <p className="text-sm">
                You’re in a consultation with <span className="font-semibold">{inProgress.patientName}</span>
              </p>
            </div>
            <Button size="sm" onClick={() => router.push(`/doctor/consult/${inProgress.id}`)}>
              Return to room <ArrowRight />
            </Button>
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile icon={<CalendarDays />} label="Appointments today" value={String(visits.filter((v) => v.status !== 'cancelled').length)} />
          <StatTile icon={<Users />} label="In waiting room" value={String(presentCount)} highlight={presentCount > 0} />
          <StatTile icon={<CircleCheck />} label="Seen today" value={String(completed)} />
          <StatTile icon={<Hourglass />} label="Longest wait" value={presentCount ? formatWait(longestWait) : '—'} warn={longestWait > 15 * 60_000} />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          {/* Waiting room */}
          <Card className="flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <h2 className="font-semibold">Waiting room</h2>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700">
                  <span className="size-1.5 rounded-full bg-brand-500" /> Live
                </span>
              </div>
              <Badge tone={presentCount ? 'brand' : 'neutral'}>{presentCount} waiting</Badge>
            </div>

            {waiting.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
                <span className="grid size-14 place-items-center rounded-full bg-slate-50 text-slate-400">
                  <Armchair className="size-6" />
                </span>
                <p className="mt-4 font-medium">No one’s waiting yet</p>
                <p className="mt-1 max-w-xs text-sm text-slate-500">Patients appear here the moment they check in. You’ll hear a chime when someone arrives.</p>
              </div>
            ) : (
              <ul className="space-y-2 p-3">
                {waiting.map((v) => {
                  const waited = v.waitingSince ? now - Date.parse(v.waitingSince) : 0;
                  return (
                    <li
                      key={v.id}
                      className={clsx(
                        'flex items-start gap-3 rounded-xl border p-3.5 transition animate-fade-in',
                        v.present ? 'border-slate-200 hover:border-brand-200 hover:bg-brand-50/30' : 'border-dashed border-slate-200 opacity-70',
                      )}
                    >
                      <Avatar name={v.patientName} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <p className="truncate font-medium">{v.patientName}</p>
                          {!v.present && <Badge tone="amber">Stepped away</Badge>}
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500" suppressHydrationWarning>
                          Booked {formatTime(v.start)} ·{' '}
                          <span className={clsx(waited > 15 * 60_000 && 'font-medium text-amber-600')}>waiting {formatWait(waited)}</span>
                        </p>
                        <p className="mt-1.5 line-clamp-2 text-sm text-slate-600">{v.reason}</p>
                      </div>
                      <Button size="sm" onClick={() => callIn(v.id)} loading={admitting === v.id} disabled={!!admitting || !v.present}>
                        <Video /> Call in
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* Schedule */}
          <Card>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold">Today’s schedule</h2>
              <span className="text-xs text-slate-500">{visits.length} visits</span>
            </div>
            {visits.length === 0 ? (
              <p className="px-5 py-16 text-center text-sm text-slate-500">No video visits scheduled today.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {visits.map((v) => {
                  const past = v.status === 'completed' || v.status === 'cancelled';
                  return (
                    <li key={v.id} className={clsx('flex items-center gap-4 px-5 py-3.5', past && 'opacity-60')}>
                      <div className="w-16 shrink-0 text-right">
                        <p className="text-sm font-semibold tabular-nums">{formatTime(v.start)}</p>
                      </div>
                      <span
                        className={clsx(
                          'h-10 w-1 shrink-0 rounded-full',
                          v.status === 'in_progress' ? 'bg-sky-500' : v.present ? 'bg-brand-500' : past ? 'bg-slate-200' : 'bg-slate-300',
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-sm font-medium">
                          <span className="truncate">{v.patientName}</span>
                          {fresh.has(v.id) && <Badge tone="violet">New</Badge>}
                        </p>
                        <p className="truncate text-xs text-slate-500">{v.reason}</p>
                      </div>
                      <StatusBadge v={v} />
                      <div className="flex shrink-0 items-center gap-1">
                        {!past && (
                          <button
                            type="button"
                            onClick={() => copyLink(v)}
                            title="Copy patient’s visit link"
                            aria-label="Copy patient’s visit link"
                            className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                          >
                            {copied === v.id ? <Check className="size-4 text-brand-600" /> : <Link2 className="size-4" />}
                          </button>
                        )}
                        {v.status === 'in_progress' && (
                          <Button size="sm" variant="secondary" onClick={() => router.push(`/doctor/consult/${v.id}`)}>
                            Resume
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <Card className="mt-6">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold">Upcoming</h2>
            <span className="text-xs text-slate-500">Next 14 days</span>
          </div>
          {upcoming.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">No upcoming video visits booked.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {upcoming.map((v) => (
                <li key={v.id} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="w-28 shrink-0">
                    <p className="text-sm font-semibold">{formatDateShort(v.start)}</p>
                    <p className="text-xs text-slate-500 tabular-nums">{formatTime(v.start)}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{v.patientName}</span>
                      {fresh.has(v.id) && <Badge tone="violet">New</Badge>}
                    </p>
                    <p className="truncate text-xs text-slate-500">{v.reason}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyLink(v)}
                    title="Copy patient’s visit link"
                    aria-label="Copy patient’s visit link"
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  >
                    {copied === v.id ? <Check className="size-4 text-brand-600" /> : <Link2 className="size-4" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {demoMode && (
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-400">
            <span>Demo mode: physicians are bookable every day, 6 AM–midnight. Tip: copy a patient link (<Link2 className="inline size-3" />) and open it in another tab to join as the patient.</span>
            <button type="button" onClick={resetDemo} className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-slate-500 hover:bg-slate-100">
              <RotateCcw className="size-3" /> Reset demo
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function StatusBadge({ v }: { v: DoctorVisitView }) {
  if (v.status === 'in_progress') return <Badge tone="sky">In consultation</Badge>;
  if (v.status === 'completed') return <Badge>Completed</Badge>;
  if (v.status === 'cancelled') return <Badge tone="rose">Cancelled</Badge>;
  if (v.status === 'waiting') return v.present ? <Badge tone="brand">Waiting</Badge> : <Badge tone="amber">Stepped away</Badge>;
  return <Badge className="hidden sm:inline-flex">Scheduled</Badge>;
}

function StatTile({ icon, label, value, highlight, warn }: { icon: ReactNode; label: string; value: string; highlight?: boolean; warn?: boolean }) {
  return (
    <Card className={clsx('p-4 transition', highlight && 'border-brand-200 bg-brand-50/40')}>
      <p className="flex items-center gap-1.5 text-xs text-slate-500 [&_svg]:size-3.5">
        {icon} {label}
      </p>
      <p className={clsx('mt-1.5 text-2xl font-semibold tracking-tight tabular-nums', warn && 'text-amber-600', highlight && 'text-brand-700')} suppressHydrationWarning>
        {value}
      </p>
    </Card>
  );
}
