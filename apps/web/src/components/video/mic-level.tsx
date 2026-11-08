'use client';

import clsx from 'clsx';
import { useEffect, useState } from 'react';

/** Live microphone level meter — reassures patients their mic works. */
export function MicLevel({ stream, muted, bars = 7, className }: { stream: MediaStream | null; muted?: boolean; bars?: number; className?: string }) {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!track) return;
    const Ctx: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 50) return; // ~20 fps is plenty
      last = t;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const x = (data[i] - 128) / 128;
        sum += x * x;
      }
      const rms = Math.sqrt(sum / data.length);
      setLevel((l) => l * 0.6 + Math.min(1, rms * 5) * 0.4);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void ctx.close();
    };
  }, [stream]);

  const shown = muted ? 0 : level;
  return (
    <span className={clsx('inline-flex h-4 items-end gap-[3px]', className)} aria-hidden>
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className={clsx('w-[3px] rounded-full transition-all duration-100', shown > (i + 0.5) / bars ? 'bg-brand-500' : 'bg-slate-300')}
          style={{ height: `${35 + (i / (bars - 1)) * 65}%` }}
        />
      ))}
    </span>
  );
}
