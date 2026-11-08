'use client';

import clsx from 'clsx';
import { Mic, MicOff, PhoneOff, Video, VideoOff, WifiOff } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import type { CallState } from '@/comms/types';
import { Avatar } from '@/components/ui';
import { VideoTile } from './video-tile';

export interface VideoStageProps {
  remoteVideoRef?: RefObject<HTMLVideoElement | null>;
  overlay?: ReactNode;
  remote: MediaStream | null;
  local: MediaStream | null;
  state: CallState;
  error?: string | null;
  remoteName: string;
  remoteColor?: string;
  localName: string;
  micOn: boolean;
  camOn: boolean;
  onToggleMic(): void;
  onToggleCam(): void;
  onLeave(): void;
  leaveLabel: string;
  waitingText: string;
  header?: ReactNode;
  className?: string;
}

/** Full-bleed call view: remote video, self-view picture-in-picture, control dock. */
export function VideoStage(props: VideoStageProps) {
  const { remote, local, state, error, remoteName, remoteColor, localName, micOn, camOn } = props;
  const remoteHasVideo = !!remote?.getVideoTracks().length;

  return (
    <div className={clsx('relative h-full w-full overflow-hidden bg-stage text-white', props.className)}>
      {/* Remote participant */}
      {remote && remoteHasVideo ? (
        <VideoTile stream={remote} videoRef={props.remoteVideoRef} className="absolute inset-0" />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(ellipse_at_center,rgba(42,156,129,0.12),transparent_65%)]">
          {/* Audio-only remote still needs an element to play sound */}
          {remote && <VideoTile stream={remote} className="hidden" />}
          <div className="flex flex-col items-center gap-5 px-6 text-center animate-fade-in">
            <span className="relative">
              {!remote && <span className="absolute inset-0 rounded-full bg-brand-400/25 animate-pulse-ring" />}
              <Avatar name={remoteName} color={remoteColor ?? '#4cb79b'} size="xl" className="relative bg-white/5! ring-4 ring-white/5" />
            </span>
            <div>
              <p className="text-base font-medium">{remoteName}</p>
              <p className="mt-1 text-sm text-white/60">{remote ? 'Camera is off' : props.waitingText}</p>
            </div>
          </div>
        </div>
      )}

      {props.overlay}

      {props.header && (
        <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 bg-linear-to-b from-black/55 to-transparent px-4 pt-4 pb-10 sm:px-5">
          {props.header}
        </div>
      )}

      {remote && (
        <span className="absolute bottom-24 left-4 z-10 rounded-lg bg-black/45 px-2.5 py-1 text-xs font-medium backdrop-blur sm:left-5">
          {remoteName}
        </span>
      )}

      {/* Self view */}
      <div className="absolute right-4 bottom-24 z-10 aspect-[4/3] w-28 overflow-hidden rounded-2xl bg-slate-800 shadow-2xl ring-1 ring-white/15 sm:right-5 sm:w-44">
        {camOn && local?.getVideoTracks().length ? (
          <VideoTile stream={local} muted mirror />
        ) : (
          <div className="grid h-full place-items-center">
            <Avatar name={localName} size="md" color="#94a3b8" />
          </div>
        )}
        {!micOn && (
          <span className="absolute top-1.5 left-1.5 grid size-6 place-items-center rounded-full bg-rose-600/90">
            <MicOff className="size-3.5" />
          </span>
        )}
      </div>

      {(state === 'reconnecting' || error) && (
        <div className="absolute top-20 left-1/2 z-30 flex max-w-[90%] -translate-x-1/2 items-center gap-2 rounded-full bg-amber-500/95 px-4 py-2 text-sm font-medium text-amber-950 shadow-lg">
          <WifiOff className="size-4 shrink-0" />
          <span className="truncate">{error ?? 'Connection lost — reconnecting…'}</span>
        </div>
      )}

      {/* Controls */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-center gap-3 bg-linear-to-t from-black/50 to-transparent pt-10 pb-5">
        <RoundButton on={micOn} onClick={props.onToggleMic} label={micOn ? 'Mute microphone' : 'Unmute microphone'}>
          {micOn ? <Mic /> : <MicOff />}
        </RoundButton>
        <RoundButton on={camOn} onClick={props.onToggleCam} label={camOn ? 'Turn camera off' : 'Turn camera on'}>
          {camOn ? <Video /> : <VideoOff />}
        </RoundButton>
        <button
          type="button"
          onClick={props.onLeave}
          className="inline-flex h-12 items-center gap-2 rounded-full bg-rose-600 px-5 text-sm font-medium shadow-lg shadow-rose-900/30 transition hover:bg-rose-500 active:scale-95 [&_svg]:size-5"
        >
          <PhoneOff />
          <span className="hidden sm:inline">{props.leaveLabel}</span>
        </button>
      </div>
    </div>
  );
}

function RoundButton({ on, onClick, label, children }: { on: boolean; onClick(): void; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={!on}
      onClick={onClick}
      className={clsx(
        'grid size-12 place-items-center rounded-full transition active:scale-95 [&_svg]:size-5',
        on ? 'bg-white/12 text-white backdrop-blur hover:bg-white/20' : 'bg-white text-slate-900 hover:bg-slate-100',
      )}
    >
      {children}
    </button>
  );
}
