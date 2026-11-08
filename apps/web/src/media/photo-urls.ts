import 'server-only';
import { sign, verifySigned } from '@/lib/auth/signing';
import { appLink } from '@/lib/notify';

/**
 * Photo URLs the browser sees. They always point at Brevicor's media route
 * (app/api/media/photos/[photoId]), never at Cloudinary, and contain no
 * patient identifier, only the photo's random id.
 */

/** How long a viewing URL works. */
export const PHOTO_URL_TTL_MS = 5 * 60_000;

interface PhotoGrant {
  kind: 'photo-view';
  p: string; // photo id
  t: string; // Cloudinary transformation
  exp: number;
}

/** A short-lived signed URL for one photo and one transformation (5 minutes). */
export function signedPhotoUrl(photoId: string, transformation: string, now = Date.now()) {
  const grant: PhotoGrant = { kind: 'photo-view', p: photoId, t: transformation, exp: now + PHOTO_URL_TTL_MS };
  return `/api/media/photos/${encodeURIComponent(photoId)}?g=${sign({ ...grant })}`;
}

/** The transformation a valid, unexpired grant allows for this photo, or null. */
export function verifyPhotoGrant(photoId: string, token: string | null): string | null {
  const grant = verifySigned<PhotoGrant>(token);
  return grant?.kind === 'photo-view' && grant.p === photoId && typeof grant.t === 'string' ? grant.t : null;
}

/**
 * The stable link filed in a chart DocumentReference. It opens only for a
 * signed-in physician of the photo's clinic.
 */
export function chartImageUrl(photoId: string) {
  return appLink(`/api/media/photos/${encodeURIComponent(photoId)}`);
}

/** What the chart link delivers: the original as JPEG (the DocumentReference says image/jpeg). */
export const CHART_TRANSFORMATION = 'f_jpg,q_auto';
