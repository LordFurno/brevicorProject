import type { NormalizedRect } from './types';

export function mediaBounds(width: number, height: number, sourceWidth: number, sourceHeight: number, fit: 'cover' | 'contain') {
  const scale = (fit === 'cover' ? Math.max : Math.min)(width / sourceWidth, height / sourceHeight);
  const w = sourceWidth * scale, h = sourceHeight * scale;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}
export function normalizedPoint(x: number, y: number, bounds: ReturnType<typeof mediaBounds>) {
  return { x: Math.max(0, Math.min(1, (x - bounds.x) / bounds.width)), y: Math.max(0, Math.min(1, (y - bounds.y) / bounds.height)) };
}
export function pixelCrop(region: NormalizedRect | null, width: number, height: number) {
  if (!region) return { x: 0, y: 0, width, height };
  const x = Math.max(0, Math.min(width - 1, Math.round(region.x * width)));
  const y = Math.max(0, Math.min(height - 1, Math.round(region.y * height)));
  return { x, y, width: Math.max(1, Math.min(width - x, Math.round(region.width * width))), height: Math.max(1, Math.min(height - y, Math.round(region.height * height))) };
}
