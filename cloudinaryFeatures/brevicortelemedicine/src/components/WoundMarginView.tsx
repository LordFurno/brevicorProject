import { useEffect, useRef, useState } from 'react';
import { traceErythemaMargin, type MarginPoint } from '../cloudinary/woundMargin';

interface WoundMarginViewProps {
  src: string;
  fallbackSrc?: string;
}

type TraceStatus = 'loading' | 'traced' | 'none' | 'error';

function strokeMargin(ctx: CanvasRenderingContext2D, points: MarginPoint[]) {
  if (points.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const next = points[i + 1];
    const xc = (points[i].x + next.x) / 2;
    const yc = (points[i].y + next.y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
  }
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 3;
  ctx.stroke();
}

export function WoundMarginView({ src, fallbackSrc }: WoundMarginViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<TraceStatus>('loading');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !src) return;
    let cancelled = false;

    const paint = (img: HTMLImageElement) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setStatus('error');
        return;
      }

      const maxEdge = 720;
      const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);

      const trace = traceErythemaMargin(ctx.getImageData(0, 0, w, h));
      if (trace.traced) strokeMargin(ctx, trace.points);
      setStatus(trace.traced ? 'traced' : 'none');
    };

    const load = (url: string, allowFallback: boolean) => {
      const img = new Image();
      if (!url.startsWith('data:')) img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (!cancelled) paint(img);
      };
      img.onerror = () => {
        if (cancelled) return;
        if (allowFallback && fallbackSrc && fallbackSrc !== url) load(fallbackSrc, false);
        else setStatus('error');
      };
      img.src = url;
    };

    setStatus('loading');
    load(src, true);
    return () => {
      cancelled = true;
    };
  }, [src, fallbackSrc]);

  const caption =
    status === 'loading'
      ? 'Tracing erythematous margin…'
      : status === 'traced'
        ? 'Yellow line follows the red lesion margin'
        : status === 'none'
          ? 'No distinct red margin in this frame'
          : 'Could not read this frame for tracing';

  return (
    <div style={{ width: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: 'auto',
          maxHeight: '260px',
          objectFit: 'contain',
          display: 'block',
          backgroundColor: '#000',
        }}
      />
      <div
        style={{
          marginTop: '6px',
          fontSize: '0.68rem',
          color: status === 'traced' ? '#facc15' : '#94a3b8',
          fontFamily: 'monospace',
        }}
      >
        {caption}
      </div>
    </div>
  );
}
