import { authorizedPatient } from '@/lib/auth/patient';
import { addPhoto, getPhotos } from '@/media/visit-photos';
import { uploadPhoto } from '@/media/upload-photo';
import { photosConfigured } from '@/media/cloudinary';
import { json, jsonError, wrongOrigin } from '@/lib/http';
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (wrongOrigin(req)) return jsonError(403, 'Invalid request origin.');
  const visit = await authorizedPatient((await params).token, true);
  if (!visit) return jsonError(401, 'Please verify your visit first.');
  if (['completed', 'cancelled'].includes(visit.status))
    return jsonError(409, 'This visit has ended.');
  if ((await getPhotos(visit)).length >= 30)
    return jsonError(429, 'Photo limit reached for this visit.');
  if (!photosConfigured()) return jsonError(503, 'Photo uploads are not configured.');
  try {
    await addPhoto(visit, { ...(await uploadPhoto(req)), source: 'patient_upload' }, 'patient');
    return json({ ok: true });
  } catch (e) {
    return jsonError(
      e instanceof Error && e.message.startsWith('Choose') ? 400 : 502,
      'Photo upload failed. Choose a supported image under 20 MB and retry.',
    );
  }
}
