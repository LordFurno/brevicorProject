'use client';

import clsx from 'clsx';
import { useEffect, useRef } from 'react';

export function VideoTile({
  stream,
  muted,
  mirror,
  fit = 'cover',
  className,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  mirror?: boolean;
  fit?: 'cover' | 'contain';
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) el.play().catch(() => undefined);
  }, [stream]);

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
