import 'server-only';
import { uploadAuthenticated } from './cloudinary';
import type { VisitPhoto } from './visit-photos';

const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

/** Validates the upload and stores it as a private (authenticated) Cloudinary asset under a random id. */
export async function uploadPhoto(req: Request): Promise<VisitPhoto> {
  const form = await req.formData(),
    file = form.get('file');
  if (!(file instanceof File) || !TYPES.includes(file.type) || !file.size || file.size > 20 * 1024 * 1024)
    throw new Error('Choose a JPEG, PNG, WebP, or AVIF photo under 20 MB.');
  const asset = await uploadAuthenticated(file);
  return {
    id: crypto.randomUUID(),
    publicId: asset.publicId,
    version: asset.version,
    width: asset.width,
    height: asset.height,
    createdAt: new Date().toISOString(),
    notes: '',
    diagnosis: '',
    source: form.get('source') === 'in_call_capture' ? 'in_call_capture' : 'patient_upload',
  };
}
