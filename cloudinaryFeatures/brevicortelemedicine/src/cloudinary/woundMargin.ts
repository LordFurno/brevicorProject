import { isErythemaPixel } from './erythemaDetector';

export interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface MarginPoint {
  x: number;
  y: number;
}

export interface MarginTrace {
  traced: boolean;
  points: MarginPoint[];
  pixelCount: number;
}

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

function dilate(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let dy = -radius; dy <= radius && !on; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < w && mask[ny * w + nx]) {
            on = 1;
            break;
          }
        }
      }
      out[y * w + x] = on;
    }
  }
  return out;
}

function erode(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 1;
      for (let dy = -radius; dy <= radius && on; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) {
          on = 0;
          break;
        }
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w || !mask[ny * w + nx]) {
            on = 0;
            break;
          }
        }
      }
      out[y * w + x] = on;
    }
  }
  return out;
}

function largestComponent(mask: Uint8Array, w: number, h: number, minArea: number): Uint8Array {
  const seen = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  let best: number[] = [];
  const stack: number[] = [];

  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    const comp: number[] = [];
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop() as number;
      comp.push(p);
      const x = p % w;
      const y = (p / w) | 0;
      if (x > 0) {
        const n = p - 1;
        if (mask[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
      if (x + 1 < w) {
        const n = p + 1;
        if (mask[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
      if (y > 0) {
        const n = p - w;
        if (mask[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
      if (y + 1 < h) {
        const n = p + w;
        if (mask[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    if (comp.length > best.length) best = comp;
  }

  if (best.length < minArea) return out;
  for (const p of best) out[p] = 1;
  return out;
}

/** Moore neighborhood walk around the outer edge of a solid mask. */
function traceOuterContour(mask: Uint8Array, w: number, h: number): MarginPoint[] {
  let sx = -1;
  let sy = -1;
  for (let y = 0; y < h && sx < 0; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        sx = x;
        sy = y;
        break;
      }
    }
  }
  if (sx < 0) return [];

  const points: MarginPoint[] = [{ x: sx, y: sy }];
  let px = sx;
  let py = sy;
  let bx = sx;
  let by = sy - 1;

  for (let step = 0; step < w * h; step++) {
    let startDir = 0;
    for (let d = 0; d < 8; d++) {
      if (px + NEIGHBORS[d][0] === bx && py + NEIGHBORS[d][1] === by) {
        startDir = (d + 1) % 8;
        break;
      }
    }

    let found = false;
    let nx = px;
    let ny = py;
    for (let i = 0; i < 8; i++) {
      const nd = (startDir + i) % 8;
      const tx = px + NEIGHBORS[nd][0];
      const ty = py + NEIGHBORS[nd][1];
      if (tx >= 0 && ty >= 0 && tx < w && ty < h && mask[ty * w + tx]) {
        nx = tx;
        ny = ty;
        found = true;
        break;
      }
    }
    if (!found) break;
    if (nx === sx && ny === sy && points.length > 4) break;
    points.push({ x: nx, y: ny });
    bx = px;
    by = py;
    px = nx;
    py = ny;
  }

  return points;
}

function smoothClosed(points: MarginPoint[], window: number): MarginPoint[] {
  const n = points.length;
  if (n < window * 2) return points;
  const smoothed: MarginPoint[] = [];
  for (let i = 0; i < n; i++) {
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (let k = -window; k <= window; k++) {
      const p = points[(i + k + n) % n];
      sx += p.x;
      sy += p.y;
      count++;
    }
    if (i % 2 === 0) smoothed.push({ x: sx / count, y: sy / count });
  }
  return smoothed;
}

function countOn(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return n;
}

/**
 * Trace the dominant erythematous region. Coordinates are in the raster's pixel space.
 * Cloudinary's outline effect cannot do this: it only strokes transparent image bounds.
 */
export function traceErythemaMargin(raster: Raster): MarginTrace {
  const { data, width, height } = raster;
  if (!width || !height) return { traced: false, points: [], pixelCount: 0 };

  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (data[o + 3] < 128) continue;
    if (isErythemaPixel(data[o], data[o + 1], data[o + 2])) mask[i] = 1;
  }

  const closed = erode(dilate(mask, width, height, 1), width, height, 1);
  const minArea = Math.max(48, Math.round(width * height * 0.00025));
  const lesion = largestComponent(closed, width, height, minArea);
  const pixelCount = countOn(lesion);
  if (!pixelCount) return { traced: false, points: [], pixelCount: 0 };

  // Sit the stroke just outside the red core so it reads as a border, not a fill.
  const contour = smoothClosed(traceOuterContour(dilate(lesion, width, height, 1), width, height), 5);
  if (contour.length < 8) return { traced: false, points: [], pixelCount };

  return { traced: true, points: contour, pixelCount };
}
