import { isPatientVerified } from '@/lib/auth/patient';
import { getVisitStore } from '@/lib/visits/store';
import { addPhoto, getPhotos, photoContext } from '@/media/visit-photos';

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return Response.json({ error: 'Invalid request origin.' }, { status: 403 });
  const { token } = await params;
  const visit = await getVisitStore().getByToken(token);
  if (!visit || !(await isPatientVerified(visit.id))) return Response.json({ error: 'Please verify your visit first.' }, { status: 401 });
  if (visit.status === 'completed' || visit.status === 'cancelled') return Response.json({ error: 'This visit has ended.' }, { status: 409 });
  if (getPhotos(visit.id).length >= 30) return Response.json({ error: 'Photo limit reached for this visit.' }, { status: 429 });
  const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const preset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
  if (!cloud || !preset) return Response.json({ error: 'Photo uploads are not configured.' }, { status: 503 });
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File) || !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type) || file.size === 0 || file.size > 20 * 1024 * 1024) return Response.json({ error: 'Choose a JPEG, PNG, WebP, or AVIF photo under 20 MB.' }, { status: 400 });
    const body = new FormData(); body.append('file', file, `visit-photo-${crypto.randomUUID()}`); body.append('upload_preset', preset);
    const result = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/upload`, { method: 'POST', body, signal: AbortSignal.timeout(60000) });
    const data = await result.json();
    if (!result.ok || !data.public_id) return Response.json({ error: 'Cloudinary could not upload this photo. Check the unsigned preset and try again.' }, { status: 502 });
    addPhoto(visit.id, { id: crypto.randomUUID(), publicId: data.public_id, version: data.version, width: data.width, height: data.height, createdAt: new Date().toISOString(), notes: '', diagnosis: '' }, photoContext(visit));
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Photo upload failed. Please try again.' }, { status: 502 });
  }
}
