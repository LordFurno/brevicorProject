import type { CropRect } from '../types';

export interface CloudinaryUploadResponse {
  public_id: string;
  secure_url: string;
  url: string;
  width: number;
  height: number;
  format: string;
  created_at: string;
  bytes: number;
}

/**
 * Grabs a frame from a live HTMLVideoElement or animated HTMLCanvasElement.
 * If cropRect is provided, captures the specified Region of Interest (ROI).
 */
export function captureFrameFromMedia(
  source: HTMLVideoElement | HTMLCanvasElement,
  cropRect?: CropRect
): string | null {
  try {
    const canvas = document.createElement('canvas');
    let srcWidth = 0;
    let srcHeight = 0;

    if (source instanceof HTMLVideoElement) {
      srcWidth = source.videoWidth;
      srcHeight = source.videoHeight;
    } else {
      srcWidth = source.width;
      srcHeight = source.height;
    }

    if (!srcWidth || !srcHeight) {
      return null;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    if (cropRect && cropRect.width > 15 && cropRect.height > 15) {
      // Clamp coordinates to valid source dimensions
      const sx = Math.max(0, Math.min(cropRect.x, srcWidth - 10));
      const sy = Math.max(0, Math.min(cropRect.y, srcHeight - 10));
      const sw = Math.min(cropRect.width, srcWidth - sx);
      const sh = Math.min(cropRect.height, srcHeight - sy);

      canvas.width = Math.round(sw);
      canvas.height = Math.round(sh);
      ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    } else {
      canvas.width = srcWidth;
      canvas.height = srcHeight;
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    }

    return canvas.toDataURL('image/jpeg', 0.95);
  } catch (err) {
    console.error('Frame capture failed:', err);
    return null;
  }
}

/**
 * Uploads a base64 Data URL to Cloudinary via the REST upload endpoint.
 */
export async function uploadFrameToCloudinary(
  base64DataUrl: string,
  cloudName: string,
  uploadPreset: string,
  tags: string[] = ['telemed', 'diagnostic_snapshot', 'ephemeral']
): Promise<CloudinaryUploadResponse> {
  const formData = new FormData();
  formData.append('file', base64DataUrl);
  if (uploadPreset) {
    formData.append('upload_preset', uploadPreset);
  }
  if (tags.length > 0) {
    formData.append('tags', tags.join(','));
  }

  const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData,
  });

  const data = await response.json();
  if (!response.ok) {
    const errorMsg = data?.error?.message || `Upload failed with status ${response.status}`;
    throw new Error(errorMsg);
  }

  return data as CloudinaryUploadResponse;
}
