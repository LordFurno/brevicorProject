import 'server-only';
import type { VisitPhoto } from './visit-photos';

export async function uploadPhoto(req: Request): Promise<VisitPhoto> {
  const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME, preset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
  if (!cloud || !preset) throw new Error('Photo uploads are not configured.');
  const form = await req.formData(), file = form.get('file');
  if (!(file instanceof File) || !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type) || !file.size || file.size > 20 * 1024 * 1024) throw new Error('Choose a JPEG, PNG, WebP, or AVIF photo under 20 MB.');
  const body = new FormData(); body.append('file', file, `visit-photo-${crypto.randomUUID()}`); body.append('upload_preset', preset);
  const result = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/upload`, { method: 'POST', body, signal: AbortSignal.timeout(60000) });
  const data = await result.json();
  if (!result.ok || !data.public_id) throw new Error('Cloudinary could not upload this photo. Check the unsigned preset and try again.');
  return { id: crypto.randomUUID(), publicId: data.public_id, version: data.version, width: data.width, height: data.height, createdAt: new Date().toISOString(), notes: '', diagnosis: '', source: form.get('source') === 'in_call_capture' ? 'in_call_capture' : 'patient_upload' };
}
