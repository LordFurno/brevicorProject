import type { NormalizedRect } from './types';
import { pixelCrop } from './region-geometry';

export function photoFilename(type: string) {
  const extension = ({ 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' } as Record<string, string>)[type] || 'jpg';
  return `consultation-${crypto.randomUUID()}.${extension}`;
}

export async function captureVideoFrame(video: HTMLVideoElement, region: NormalizedRect | null): Promise<Blob> {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) throw new Error('Wait for the patient video to connect before capturing a frame.');
  const area = pixelCrop(region, video.videoWidth, video.videoHeight);
  // A fresh canvas reads the current video frame for every capture.
  const canvas = document.createElement('canvas'); canvas.width = area.width; canvas.height = area.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not capture the video. Upload a photo instead.');
  ctx.drawImage(video, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
  if (!blob) throw new Error('Could not capture this frame. Try again.');
  return blob;
}
