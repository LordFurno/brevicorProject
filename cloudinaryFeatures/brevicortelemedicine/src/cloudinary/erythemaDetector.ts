import type { NormalizedRect } from '../types';

export interface DetectionResult {
  detected: boolean;
  box: NormalizedRect | null;
  confidence: number;
  message: string;
}

/** Inflamed skin, rash, and fresh wound pixels. Normal skin sits near R/G 1.1–1.35. */
export function isErythemaPixel(r: number, g: number, b: number): boolean {
  const totalIntensity = r + g + b + 0.001;
  const erythemaScore = (r - g) / totalIntensity;
  const rgRatio = r / (g + 1);
  return r > 95 && rgRatio > 1.55 && erythemaScore > 0.2 && r > b * 1.25;
}

/**
 * Scans an HTMLVideoElement or HTMLCanvasElement for erythema / red lesion clusters.
 * Normal human skin has R/G ratios ~ 1.1 - 1.35.
 * Inflamed skin, rashes, burns, cuts, and red marks have R/G > 1.6 and high Erythema Index.
 */
export function detectErythemaHotspot(
  source: HTMLVideoElement | HTMLCanvasElement
): DetectionResult {
  try {
    const canvas = document.createElement('canvas');
    let width = 0;
    let height = 0;

    if (source instanceof HTMLVideoElement) {
      width = source.videoWidth;
      height = source.videoHeight;
    } else {
      width = source.width;
      height = source.height;
    }

    if (!width || !height) {
      return { detected: false, box: null, confidence: 0, message: 'Video stream not ready' };
    }

    // Downscale for fast real-time pixel analysis (e.g. max 320x240)
    const scale = Math.min(1, 320 / width);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { detected: false, box: null, confidence: 0, message: 'Canvas context unavailable' };
    }

    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    let totalPoints = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = canvas.width;
    let maxX = 0;
    let minY = canvas.height;
    let maxY = 0;

    // Scan every 2nd pixel for speed
    for (let y = 0; y < canvas.height; y += 2) {
      for (let x = 0; x < canvas.width; x += 2) {
        const idx = (y * canvas.width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        if (isErythemaPixel(r, g, b)) {
          totalPoints++;
          sumX += x;
          sumY += y;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    // Need a minimum cluster size of red pixels (e.g. at least 30 pixels in low-res scan)
    if (totalPoints < 25) {
      return {
        detected: false,
        box: null,
        confidence: 0,
        message: 'No distinct red lesion cluster detected on arm. Ensure good lighting or drag box manually.',
      };
    }

    const avgX = sumX / totalPoints;
    const avgY = sumY / totalPoints;

    // Add padding around the detected red mark (25% padding)
    const detectedW = Math.max(maxX - minX, 40);
    const detectedH = Math.max(maxY - minY, 40);
    const padW = detectedW * 0.35;
    const padH = detectedH * 0.35;

    const clampedMinX = Math.max(0, avgX - detectedW / 2 - padW);
    const clampedMinY = Math.max(0, avgY - detectedH / 2 - padH);
    const clampedW = Math.min(canvas.width - clampedMinX, detectedW + padW * 2);
    const clampedH = Math.min(canvas.height - clampedMinY, detectedH + padH * 2);

    const normBox: NormalizedRect = {
      x: clampedMinX / canvas.width,
      y: clampedMinY / canvas.height,
      width: clampedW / canvas.width,
      height: clampedH / canvas.height,
    };

    return {
      detected: true,
      box: normBox,
      confidence: Math.min(0.98, totalPoints / 300),
      message: `Detected erythema hotspot (${totalPoints} red mark pixels identified).`,
    };
  } catch (err) {
    console.error('Erythema scan error:', err);
    return { detected: false, box: null, confidence: 0, message: 'Detection error' };
  }
}

