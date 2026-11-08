'use client';

import clsx from 'clsx';
import {
  Armchair,
  Check,
  Clock,
  Coffee,
  Headphones,
  Mic,
  MicOff,
  NotebookPen,
  ShieldCheck,
  TriangleAlert,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useState, useRef, type ReactNode, type RefObject } from 'react';
import { Logo } from '@/components/logo';
import { Alert, Avatar, Button, Card } from '@/components/ui';
import { useNow } from '@/components/use-now';
import { MicLevel } from '@/components/video/mic-level';
import type { LocalMedia } from '@/components/video/use-local-media';
import { VideoTile } from '@/components/video/video-tile';
import { formatClock, formatTime, formatWait } from '@/lib/time';
import type { PatientStatus } from '@/lib/visits/types';
import type { DoctorInfo } from './visit-flow';

/** The virtual waiting room: device check on the left, "your place in line" on the right. */
export function Lobby({
  doctor,
  clinicName,
  start,
  status,
  media,
  left,
  onRejoin,
  photoUpload,
  checkInError,
  onRetryCheckIn,
}: {
  checkInError?: string;
  onRetryCheckIn?: () => void;
  photoUpload?: (ref: RefObject<HTMLVideoElement | null>, cameraOn: boolean) => ReactNode;
  doctor: DoctorInfo;
  clinicName: string;
  start: string;
  status: PatientStatus | null;
  media: LocalMedia;
  left: boolean;
  onRejoin(): void;
}) {
  const cameraRef = useRef<HTMLVideoElement>(null);
  const now = useNow(1000);

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <span className="hidden text-sm text-slate-500 sm:block">{clinicName}</span>
      </header>

      <main className="mx-auto grid max-w-6xl gap-5 px-4 pb-12 sm:px-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-6">
        {/* Device check */}
        <Card className="overflow-hidden p-2.5 animate-fade-in">
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-900 sm:aspect-video">
            {media.camOn && media.hasVideo ? (
              <VideoTile stream={media.stream} videoRef={cameraRef} muted mirror />
            ) : (
              <div className="grid h-full place-items-center">
                <div className="flex flex-col items-center gap-3 text-white/70">
                  <Avatar name="You" color="#94a3b8" size="lg" />
                  <p className="text-sm">{media.stream ? 'Your camera is off' : 'Starting your camera…'}</p>
                </div>
              </div>
            )}
            <span className="absolute top-3 left-3 rounded-lg bg-black/45 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
              Preview — only you can see this
            </span>
            <div className="absolute inset-x-0 bottom-0 flex justify-center gap-3 bg-linear-to-t from-black/50 to-transparent pt-10 pb-4">
              <PreviewToggle on={media.micOn} onClick={media.toggleMic} label={media.micOn ? 'Mute' : 'Unmute'} disabled={!media.hasAudio}>
                {media.micOn ? <Mic /> : <MicOff />}
              </PreviewToggle>
              <PreviewToggle on={media.camOn} onClick={media.toggleCam} label={media.camOn ? 'Camera off' : 'Camera on'} disabled={!media.hasVideo}>
                {media.camOn ? <Video /> : <VideoOff />}
              </PreviewToggle>
            </div>
          </div>

          <div className="grid gap-2 p-3 pt-4 sm:grid-cols-3">
            <CheckRow ok={media.hasVideo} label="Camera" detail={media.hasVideo ? 'Looks good' : 'Not available'} />
            <CheckRow ok={media.hasAudio} label="Microphone" detail={<MicLevel stream={media.stream} muted={!media.micOn} />} />
            <SpeakerTest />
          </div>
          {media.error && (
            <Alert tone="amber" className="mx-3 mb-3">
              <TriangleAlert /> {media.error}
            </Alert>
          )}
        </Card>

        {/* Status */}
        <div className="flex flex-col gap-5">
          {checkInError && <Alert tone="amber"><div><p>{checkInError}</p><Button variant="secondary" size="sm" className="mt-2" onClick={onRetryCheckIn}>Retry check-in</Button></div></Alert>}
          {photoUpload?.(cameraRef, media.camOn && media.hasVideo)}
          <Card className="p-6 animate-fade-in sm:p-7" style={{ animationDelay: '80ms' }}>
            <StatusPanel doctor={doctor} start={start} status={status} now={now} left={left} onRejoin={onRejoin} />
          </Card>

          <Card className="p-6 animate-fade-in" style={{ animationDelay: '160ms' }}>
            <p className="text-sm font-semibold">While you wait</p>
            <ul className="mt-3 space-y-3 text-sm text-slate-600 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-brand-600">
              <li className="flex gap-3"><ShieldCheck className="mt-0.5" />Find a quiet, private spot where you’re comfortable talking.</li>
              <li className="flex gap-3"><Headphones className="mt-0.5" />Headphones help with privacy and sound quality.</li>
              <li className="flex gap-3"><NotebookPen className="mt-0.5" />Have your medications and any questions handy.</li>
            </ul>
          </Card>
        </div>
      </main>
    </div>
  );
}

function StatusPanel({
  doctor,
  start,
  status,
  now,
  left,
  onRejoin,
}: {
  doctor: DoctorInfo;
  start: string;
  status: PatientStatus | null;
  now: number;
  left: boolean;
  onRejoin(): void;
}) {
  const header = (
    <div className="flex items-center gap-3">
      <span className="relative">
        <span className="absolute inset-0 rounded-full bg-brand-300/40 animate-breathe" />
        <Avatar name={doctor.name} color={doctor.color} size="lg" className="relative bg-white!" />
      </span>
      <div>
        <p className="font-semibold">{doctor.name}</p>
        <p className="text-sm text-slate-500">{doctor.specialty}</p>
      </div>
    </div>
  );

  const apptLine = (
    <p className="mt-5 flex items-center gap-1.5 border-t border-slate-100 pt-4 text-sm text-slate-500">
      <Clock className="size-4" /> Appointment at {formatTime(start)}
    </p>
  );

  if (!status) {
    return (
      <>
        {header}
        <div className="mt-6 space-y-2">
          <div className="h-6 w-2/3 animate-pulse rounded-lg bg-slate-100" />
          <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
        </div>
      </>
    );
  }

  if (left && status.phase === 'in_call') {
    return (
      <>
        {header}
        <h2 className="mt-6 text-xl font-semibold tracking-tight">You left the visit</h2>
        <p className="mt-1.5 text-slate-600">{doctor.short} is still in the room. You can rejoin any time.</p>
        <Button size="lg" className="mt-5 w-full" onClick={onRejoin}>
          Rejoin visit
        </Button>
        {apptLine}
      </>
    );
  }

  if (status.phase === 'too_early') {
    const ms = Date.parse(status.canEnterAt) - now;
    return (
      <>
        {header}
        <div className="mt-6 flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600">
            <Coffee className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">You’re a little early</h2>
            <p className="mt-1 text-slate-600">
              Your physician can see that you have arrived early. Check-in opens at {formatTime(status.canEnterAt)}. Keep this page open and we’ll check you in automatically.
            </p>
          </div>
        </div>
        <p className="mt-5 text-center font-mono text-4xl font-semibold tracking-tight text-slate-900 tabular-nums">{formatClock(ms)}</p>
        {apptLine}
      </>
    );
  }

  // Waiting (or the brief moment before the call view takes over)
  const position = status.queuePosition ?? 1;
  const title = status.phase === 'in_call'
    ? `${doctor.short} is ready for you`
    : status.doctorBusy
      ? `${doctor.short} is with another patient`
      : status.minutesLate > 0
        ? `${doctor.short} is running a little behind`
        : 'You’re checked in';
  const body = status.phase === 'in_call'
    ? 'Bringing you into the room…'
    : status.doctorBusy || status.minutesLate > 0
      ? 'Thanks for your patience — you won’t lose your spot. You’ll be brought into the room automatically.'
      : 'Please stay on this page. You’ll be brought into the room as soon as your doctor is ready.';

  return (
    <>
      {header}
      <div className="mt-6">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-200/60 ring-inset">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-brand-500" />
          </span>
          In the waiting room
        </span>
        <h2 className="mt-3 text-xl font-semibold tracking-tight text-balance">{title}</h2>
        <p className="mt-1.5 text-slate-600">{body}</p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <Stat icon={<Armchair />} label="Your place" value={position <= 1 ? 'You’re next' : `${position - 1} ahead`} />
        <Stat icon={<Clock />} label="Waiting" value={status.waitingSince ? formatWait(now - Date.parse(status.waitingSince)) : '—'} />
      </div>
      {apptLine}
    </>
  );
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3.5">
      <p className="flex items-center gap-1.5 text-xs text-slate-500 [&_svg]:size-3.5">
        {icon} {label}
      </p>
      <p className="mt-1 font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function CheckRow({ ok, label, detail }: { ok: boolean; label: string; detail: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
      <span className={clsx('grid size-6 shrink-0 place-items-center rounded-full', ok ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-500')}>
        <Check className="size-3.5" strokeWidth={3} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium leading-tight">{label}</p>
        <div className="mt-0.5 text-xs text-slate-500">{detail}</div>
      </div>
    </div>
  );
}

function SpeakerTest() {
  const [playing, setPlaying] = useState(false);
  const play = () => {
    try {
      const ctx = new AudioContext();
      const notes = [523.25, 659.25, 783.99];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const t = ctx.currentTime + i * 0.22;
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.2, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + 0.55);
      });
      setPlaying(true);
      setTimeout(() => {
        setPlaying(false);
        void ctx.close();
      }, 1200);
    } catch {
      /* no audio output */
    }
  };
  return (
    <button type="button" onClick={play} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-left transition hover:bg-slate-100">
      <span className={clsx('grid size-6 shrink-0 place-items-center rounded-full', playing ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-600')}>
        {playing ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
      </span>
      <div>
        <p className="text-sm font-medium leading-tight">Speakers</p>
        <p className="mt-0.5 text-xs text-brand-700">{playing ? 'Playing…' : 'Play test sound'}</p>
      </div>
    </button>
  );
}

function PreviewToggle({ on, onClick, label, disabled, children }: { on: boolean; onClick(): void; label: string; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={clsx(
        'grid size-11 place-items-center rounded-full transition active:scale-95 disabled:opacity-40 [&_svg]:size-5',
        on ? 'bg-white/15 text-white backdrop-blur hover:bg-white/25' : 'bg-rose-600 text-white hover:bg-rose-500',
      )}
    >
      {children}
    </button>
  );
}
