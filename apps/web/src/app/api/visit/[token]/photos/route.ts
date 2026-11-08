import { authorizedPatient } from '@/lib/auth/patient';
import { addPhoto, getPhotos } from '@/media/visit-photos';
import { uploadPhoto } from '@/media/upload-photo';
import { json, jsonError } from '@/lib/http';
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (req.headers.has('origin') && req.headers.get('origin') !== new URL(req.url).origin)
    return jsonError(403, 'Invalid request origin.');
  const visit = await authorizedPatient((await params).token, true);
  if (!visit) return jsonError(401, 'Please verify your visit first.');
  if (['completed', 'cancelled'].includes(visit.status))
    return jsonError(409, 'This visit has ended.');
  if ((await getPhotos(visit)).length >= 30)
    return jsonError(429, 'Photo limit reached for this visit.');
  const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
    preset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
  if (!cloud || !preset) return jsonError(503, 'Photo uploads are not configured.');
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
