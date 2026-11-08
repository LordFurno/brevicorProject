'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChevronLeft, Lock, PhoneOff } from 'lucide-react';
import type { JoinCredentials } from '@/comms/types';
import { Button } from '@/components/ui';
import { useNow } from '@/components/use-now';
import { useCall } from '@/components/video/use-call';
import { useLocalMedia } from '@/components/video/use-local-media';
import { VideoStage } from '@/components/video/video-stage';
import type { ChartSummary } from '@/lib/clinical/types';
import { formatClock } from '@/lib/time';
import type { DoctorVisitView } from '@/lib/visits/types';
import { PatientChart } from './patient-chart';

export function ConsultRoom({ visit, chart, clinicName }: { visit: DoctorVisitView; chart: ChartSummary; clinicName: string }) {
  const router = useRouter();
  const media = useLocalMedia(true);
  const now = useNow(1000);
  const [creds, setCreds] = useState<JoinCredentials | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [admittedAt, setAdmittedAt] = useState(visit.admittedAt ?? null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/doctor/visits/${visit.id}/join`, { method: 'POST', cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? 'Could not start the video call');
        if (cancelled) return;
        setCreds(d as JoinCredentials);
        setAdmittedAt((a) => a ?? new Date().toISOString());
      })
      .catch((e: Error) => !cancelled && setJoinError(e.message));
    return () => {
      cancelled = true;
    };
  }, [visit.id]);

  const call = useCall(creds, media.stream);
  const firstName = visit.patientName.split(' ')[0];

  async function endVisit() {
    setEnding(true);
    await fetch(`/api/doctor/visits/${visit.id}/end`, { method: 'POST' }).catch(() => null);
    call.session.current?.disconnect();
    router.push('/doctor');
    router.refresh();
  }

  return (
    <div className="flex h-dvh flex-col bg-stage lg:flex-row">
      {/* Left: the patient */}
      <section className="relative h-[46dvh] shrink-0 lg:h-full lg:w-1/2">
        <VideoStage
          remote={call.remote}
          local={media.stream}
          state={call.state}
          error={joinError ?? call.error ?? media.error}
          remoteName={visit.patientName}
          localName="You"
          micOn={media.micOn}
          camOn={media.camOn}
          onToggleMic={() => call.session.current?.setMicEnabled(media.toggleMic())}
          onToggleCam={() => call.session.current?.setCameraEnabled(media.toggleCam())}
          onLeave={() => setConfirmEnd(true)}
          leaveLabel="End visit"
          waitingText={`Calling ${firstName} in from the waiting room…`}
          header={
            <>
              <Link
                href="/doctor"
                className="inline-flex items-center gap-1 rounded-full bg-white/10 py-1.5 pr-3 pl-2 text-xs font-medium text-white/90 backdrop-blur transition hover:bg-white/20"
              >
                <ChevronLeft className="size-4" /> Dashboard
              </Link>
              <div className="flex items-center gap-2">
                <span className="hidden items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/80 backdrop-blur sm:inline-flex">
                  <Lock className="size-3" /> Encrypted
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white tabular-nums backdrop-blur">
                  <span className="size-2 animate-pulse rounded-full bg-rose-500" />
                  {formatClock(admittedAt ? now - Date.parse(admittedAt) : 0)}
                </span>
              </div>
            </>
          }
        />
      </section>

      {/* Right: their chart from the clinic */}
      <aside className="scroll-thin min-h-0 flex-1 overflow-y-auto rounded-t-[28px] bg-white lg:w-1/2 lg:rounded-t-none lg:rounded-l-[28px]">
        <PatientChart chart={chart} reason={visit.reason} clinicName={clinicName} />
      </aside>

      {confirmEnd && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="end-title">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <span className="grid size-11 place-items-center rounded-full bg-rose-50 text-rose-600">
              <PhoneOff className="size-5" />
            </span>
            <h2 id="end-title" className="mt-4 text-lg font-semibold">
              End visit with {firstName}?
            </h2>
            <p className="mt-1.5 text-sm text-slate-600">
              The call ends for both of you. The clinical encounter stays open so you can finish your notes.
            </p>
            <div className="mt-6 flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmEnd(false)} disabled={ending}>
                Cancel
              </Button>
              <Button variant="danger" className="flex-1" onClick={endVisit} loading={ending}>
                End visit
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
