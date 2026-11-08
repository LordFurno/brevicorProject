import 'server-only';
import { appLink } from '@/lib/notify';

/**
 * The stable link filed in a chart DocumentReference. It points at Brevicor,
 * never at Cloudinary, and opens only for a signed-in physician of the
 * photo's clinic (app/api/media/photos/[photoId]). No patient identifier in it.
 */
export function chartImageUrl(photoId: string) {
  return appLink(`/api/media/photos/${encodeURIComponent(photoId)}`);
}
