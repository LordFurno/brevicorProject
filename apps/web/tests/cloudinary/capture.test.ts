import { afterEach, describe, expect, it, vi } from 'vitest';
import { mediaBounds, normalizedPoint, pixelCrop } from '../../src/components/cloudinary/region-geometry';
import { captureVideoFrame, photoFilename } from '../../src/components/cloudinary/capture-frame';
import { getEnhancedImage } from '../../src/components/cloudinary/enhancements';

afterEach(() => vi.unstubAllGlobals());

describe('region coordinate mapping', () => {
  it('maps selection on a center-cropped video back to its original pixels', () => {
    const bounds = mediaBounds(500, 500, 1920, 1080, 'cover');
    const point = normalizedPoint(0, 0, bounds);
    expect(point.x).toBeCloseTo(0.21875); expect(point.y).toBe(0);
    const end = normalizedPoint(500, 500, bounds);
    const crop = pixelCrop({ ...point, width: end.x - point.x, height: end.y - point.y }, 1920, 1080);
    expect(crop).toEqual({ x: 420, y: 0, width: 1080, height: 1080 });
  });
  it('ignores letterboxing around a contained photo', () => {
    const bounds = mediaBounds(800, 400, 400, 400, 'contain');
    expect(normalizedPoint(200, 0, bounds)).toEqual({ x: 0, y: 0 });
    expect(normalizedPoint(600, 400, bounds)).toEqual({ x: 1, y: 1 });
    expect(normalizedPoint(0, 0, bounds)).toEqual({ x: 0, y: 0 });
  });
  it('clamps edge selections to valid pixel dimensions', () => {
    expect(pixelCrop({ x: 0.99, y: 0.99, width: 0.4, height: 0.4 }, 100, 100)).toEqual({ x: 99, y: 99, width: 1, height: 1 });
    expect(pixelCrop(null, 1920, 1080)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });
  it('applies a selected photo crop before delivery optimization and includes the asset version', () => {
    const url = getEnhancedImage('test/photo', { filter: 'raw', version: 42, region: { x: 120, y: 80, width: 300, height: 200 }, lowDataMode: true }).toURL();
    expect(url).toContain('g_north_west'); expect(url).toContain('x_120'); expect(url).toContain('y_80');
    expect(url).toContain('w_300'); expect(url).toContain('/v42/'); expect(url).toContain('q_auto:eco');
  });
});

describe('repeatable frame capture', () => {
  const video = { readyState: 2, videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
  function canvasMock(failFirst = false) {
    let count = 0;
    const draw = vi.fn();
    const create = vi.fn(() => ({ width: 0, height: 0, getContext: () => ({ drawImage: draw }), toBlob: (done: (blob: Blob | null) => void) => {
      count++; done(failFirst && count === 1 ? null : new Blob([`frame-${count}`], { type: 'image/jpeg' }));
    } }));
    vi.stubGlobal('document', { createElement: create });
    return { draw, create };
  }
  it('reads a fresh frame for each successive photo', async () => {
    const { draw, create } = canvasMock();
    const first = await captureVideoFrame(video, null);
    const second = await captureVideoFrame(video, null);
    expect(await first.text()).toBe('frame-1'); expect(await second.text()).toBe('frame-2');
    expect(create).toHaveBeenCalledTimes(2); expect(draw).toHaveBeenCalledTimes(2);
    expect(photoFilename('image/jpeg')).not.toBe(photoFilename('image/jpeg'));
  });
  it('captures exactly the selected source area', async () => {
    const { draw } = canvasMock();
    await captureVideoFrame(video, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
    expect(draw).toHaveBeenCalledWith(video, 480, 270, 960, 540, 0, 0, 960, 540);
  });
  it('can capture again after an encoder failure', async () => {
    canvasMock(true);
    await expect(captureVideoFrame(video, null)).rejects.toThrow('Could not capture');
    expect(await (await captureVideoFrame(video, null)).text()).toBe('frame-2');
  });
  it('does not capture before the video has a decoded frame', async () => {
    const { create } = canvasMock();
    await expect(captureVideoFrame({ ...video, readyState: 1 } as HTMLVideoElement, null)).rejects.toThrow('Wait for');
    expect(create).not.toHaveBeenCalled();
  });
});
