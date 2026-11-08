'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, CalendarClock, Heart, Lock, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import type { JoinCredentials } from '@/comms/types';
import { Logo } from '@/components/logo';
import { Alert, Avatar, Button, buttonClasses, Card, Field, Input } from '@/components/ui';
import { useCall } from '@/components/video/use-call';
import { useLocalMedia, type LocalMedia } from '@/components/video/use-local-media';
import { VideoStage } from '@/components/video/video-stage';
import { CLINIC_TZ_LABEL, formatDateLong, formatTime } from '@/lib/time';
import type { PatientStatus } from '@/lib/visits/types';
import { Lobby } from './lobby';
import { PatientPhotoUpload } from '@/components/cloudinary/patient-photo-upload';

export interface DoctorInfo {
  name: string;
  short: string;
  specialty: string;
  color: string;
}

interface Props {
  token: string;
  doctor: DoctorInfo;
  clinicName: string;
  start: string;
  initiallyVerified: boolean;
}

type Phase = 'verify' | 'lobby' | 'call' | 'left' | 'ended' | 'closed';

export function VisitFlow({ token, doctor, clinicName, start, initiallyVerified }: Props) {
  const [phase, setPhase] = useState<Phase>(initiallyVerified ? 'lobby' : 'verify');
  const [status, setStatus] = useState<PatientStatus | null>(null);
  const [checkInError, setCheckInError] = useState('');
  const media = useLocalMedia(phase === 'lobby' || phase === 'call' || phase === 'left');

  const poll = useCallback(async () => {
    const res = await fetch(`/api/visit/${encodeURIComponent(token)}/status`, { method: 'POST', cache: 'no-store' }).catch(() => null);
    if (!res) { setCheckInError('Unable to report your arrival. Check your connection and retry.'); return; }
    if (res.status === 401) return setPhase('verify');
    if (!res.ok) { setCheckInError('Your arrival could not be confirmed. Please retry.'); return; }
    const s = await res.json().catch(() => null) as PatientStatus | null;
    if (!s?.phase) { setCheckInError('Your arrival could not be confirmed. Please retry.'); return; }
    setCheckInError('');
    setStatus(s);
    setPhase((prev) => {
      if (s.phase === 'ended') return 'ended';
      if (s.phase === 'cancelled' || s.phase === 'expired') return 'closed';
      if (s.phase === 'in_call' && prev === 'lobby') return 'call';
      return prev;
    });
  }, [token]);

  useEffect(() => {
    if (phase === 'verify' || phase === 'ended' || phase === 'closed') return;
    void poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [phase, poll]);

  if (phase === 'verify')
    return <VerifyStep token={token} doctor={doctor} clinicName={clinicName} start={start} onVerified={() => setPhase('lobby')} />;
  if (phase === 'call') return <PatientCall token={token} doctor={doctor} media={media} onLeave={() => setPhase('left')} />;
  if (phase === 'ended') return <EndScreen doctor={doctor} clinicName={clinicName} />;
  if (phase === 'closed') return <ClosedScreen status={status} clinicName={clinicName} />;

  return (
    <Lobby
      checkInError={checkInError}
      onRetryCheckIn={() => void poll()}
      photoUpload={(cameraRef, cameraOn) => <PatientPhotoUpload token={token} cameraRef={cameraRef} cameraOn={cameraOn} />}
      doctor={doctor}
      clinicName={clinicName}
      start={start}
      status={status}
      media={media}
      left={phase === 'left'}
      onRejoin={() => setPhase('call')}
    />
  );
}

// ── Step 1: identity check ─────────────────────────────────────────

function VerifyStep({
  token,
  doctor,
  clinicName,
  start,
  onVerified,
}: {
  token: string;
  doctor: DoctorInfo;
  clinicName: string;
  start: string;
  onVerified(): void;
}) {
  const [dob, setDob] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/visit/${encodeURIComponent(token)}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateOfBirth: dob }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (res?.ok) onVerified();
    else setError(data.error ?? 'We couldn’t check your details. Please try again.');
  }

  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-8">
      <Logo />
      <Card className="mt-10 w-full max-w-md p-7 animate-fade-in sm:p-9">
        <div className="text-center">
          <Avatar name={doctor.name} color={doctor.color} size="lg" className="mx-auto" />
          <p className="mt-4 text-sm text-slate-500">{clinicName}</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Your video visit with {doctor.name}</h1>
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">
            <CalendarClock className="size-4" /> {formatDateLong(start)} · {formatTime(start)}
          </p>
        </div>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <Field label="Confirm your date of birth" htmlFor="dob">
            <Input id="dob" type="date" required autoComplete="bday" value={dob} onChange={(e) => setDob(e.target.value)} autoFocus />
          </Field>
          {error && (
            <Alert>
              <TriangleAlert /> {error}
            </Alert>
          )}
          <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!dob}>
            Continue to waiting room <ArrowRight />
          </Button>
        </form>
        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-slate-500">
          <Lock className="size-3.5" /> This makes sure only you can join your visit.
        </p>
      </Card>
    </div>
  );
}

// ── Step 3: in the consultation room ───────────────────────────────

function PatientCall({ token, doctor, media, onLeave }: { token: string; doctor: DoctorInfo; media: LocalMedia; onLeave(): void }) {
  const [creds, setCreds] = useState<JoinCredentials | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/visit/${encodeURIComponent(token)}/join`, { method: 'POST', cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? 'Could not join the visit');
        if (!cancelled) setCreds(d as JoinCredentials);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const call = useCall(creds, media.stream);

  return (
    <div className="relative h-dvh">
      <VideoStage
        remote={call.remote}
        local={media.stream}
        state={call.state}
        error={error ?? call.error}
        remoteName={doctor.name}
        remoteColor={doctor.color}
        localName="You"
        micOn={media.micOn}
        camOn={media.camOn}
        onToggleMic={() => call.session.current?.setMicEnabled(media.toggleMic())}
        onToggleCam={() => call.session.current?.setCameraEnabled(media.toggleCam())}
        onLeave={onLeave}
        leaveLabel="Leave"
        waitingText={`Connecting you with ${doctor.short}…`}
        header={
          <>
            <Logo tone="light" compact />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs text-white/80 backdrop-blur">
              <Lock className="size-3" /> Private &amp; encrypted
            </span>
          </>
        }
      />
      <div className="absolute right-4 bottom-24 z-20 w-64 max-w-[calc(100vw-2rem)]"><PatientPhotoUpload token={token} /></div>
    </div>
  );
}

// ── End states ─────────────────────────────────────────────────────

function EndScreen({ doctor, clinicName }: { doctor: DoctorInfo; clinicName: string }) {
  return (
    <div className="grid min-h-dvh place-items-center px-5">
      <div className="max-w-sm text-center animate-fade-in">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-brand-50 text-brand-600">
          <Heart className="size-7" />
        </span>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Your visit has ended</h1>
        <p className="mt-2 text-slate-600">
          Thanks for seeing {doctor.short} today. If anything was prescribed or ordered, {clinicName} will follow up with you.
        </p>
        <p className="mt-6 text-sm text-slate-500">You can close this window. Take care.</p>
        <Link href="/" className={buttonClasses('ghost', 'sm', 'mt-6')}>
          Back to Brevicor
        </Link>
      </div>
    </div>
  );
}

function ClosedScreen({ status, clinicName }: { status: PatientStatus | null; clinicName: string }) {
  const cancelled = status?.phase === 'cancelled';
  return (
    <div className="grid min-h-dvh place-items-center px-5">
      <div className="max-w-sm text-center animate-fade-in">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-amber-50 text-amber-600">
          <CalendarClock className="size-7" />
        </span>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">{cancelled ? 'This visit was cancelled' : 'This visit link has expired'}</h1>
        <p className="mt-2 text-slate-600">
          {cancelled
            ? `Please contact ${clinicName} if you still need to be seen.`
            : `The check-in window for this visit (${status ? formatTime(status.startsAt) : ''} ${CLINIC_TZ_LABEL}) has passed. Please book a new time or call ${clinicName}.`}
        </p>
        <Link href="/book" className={buttonClasses('primary', 'md', 'mt-6')}>
          Book a new visit
        </Link>
      </div>
    </div>
  );
}
