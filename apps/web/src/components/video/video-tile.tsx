'use client';

import clsx from 'clsx';
import { useEffect, useRef, type RefObject } from 'react';

export function VideoTile({
  stream,
  videoRef,
  muted,
  mirror,
  fit = 'cover',
  className,
}: {
  videoRef?: RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  muted?: boolean;
  mirror?: boolean;
  fit?: 'cover' | 'contain';
  className?: string;
}) {
  const fallbackRef = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? fallbackRef;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) el.play().catch(() => undefined);
  }, [stream, ref]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={clsx('h-full w-full', fit === 'cover' ? 'object-cover' : 'object-contain', mirror && '-scale-x-100', className)}
    />
  );
}
