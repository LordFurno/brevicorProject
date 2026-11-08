'use client';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { NormalizedRect } from './types';
import { mediaBounds, normalizedPoint } from './region-geometry';

export function RegionSelector({ width, height, fit = 'contain', value, onChange, active }: { width: number; height: number; fit?: 'contain' | 'cover'; value: NormalizedRect | null; onChange: (rect: NormalizedRect | null) => void; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const bounds = mediaBounds(size.width, size.height, width || 1, height || 1, fit);
  function point(e: PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return normalizedPoint(e.clientX - rect.left, e.clientY - rect.top, mediaBounds(rect.width, rect.height, width || 1, height || 1, fit));
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const end = point(e), origin = start.current;
    onChange({ x: Math.min(origin.x, end.x), y: Math.min(origin.y, end.y), width: Math.abs(end.x - origin.x), height: Math.abs(end.y - origin.y) });
  }
  return <div ref={ref} className={`absolute inset-0 z-10 overflow-hidden ${active ? 'cursor-crosshair touch-none' : 'pointer-events-none'}`} aria-label="Drag to select a region" onPointerDown={(e) => {
    if (!active || e.button !== 0) return;
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); start.current = point(e); onChange(null);
  }} onPointerMove={move} onPointerUp={(e) => {
    if (!start.current) return;
    move(e); const end = point(e), origin = start.current; start.current = null;
    if (Math.abs(end.x - origin.x) * bounds.width < 8 || Math.abs(end.y - origin.y) * bounds.height < 8) onChange(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }} onPointerCancel={() => { start.current = null; onChange(null); }}>
    {value && <div className="pointer-events-none absolute border-2 border-teal-300 bg-teal-300/15" style={{ left: bounds.x + value.x * bounds.width, top: bounds.y + value.y * bounds.height, width: value.width * bounds.width, height: value.height * bounds.height }} />}
    {active && !value && <span className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-black/65 px-3 py-2 text-center text-xs text-white">Drag over the area to capture</span>}
  </div>;
}
