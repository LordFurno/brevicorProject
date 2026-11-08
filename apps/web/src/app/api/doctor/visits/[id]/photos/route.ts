import { getDoctor, ownsVisit } from '@/lib/auth/doctor';
import { getVisitStore } from '@/lib/visits/store';
import { getPhotos, addPhoto, getHistory, updatePhoto } from '@/media/visit-photos';
import { uploadPhoto } from '@/media/upload-photo';
import { photosConfigured } from '@/media/cloudinary';
import { json, jsonError } from '@/lib/http';
async function authorized(id: string) {
  const doctor = await getDoctor();
  if (!doctor) return jsonError(401, 'Unauthorized');
  const visit = await getVisitStore().get(doctor.clinicId, id);
  return visit && ownsVisit(doctor, visit) ? visit : jsonError(404, 'Visit not found');
}
function wrongOrigin(req: Request) {
  return req.headers.has('origin') && req.headers.get('origin') !== new URL(req.url).origin;
}
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const visit = await authorized((await params).id);
  if (visit instanceof Response) return visit;
  try {
    return json({
      configured: photosConfigured(),
      photos: await (new URL(req.url).searchParams.get('history') === '1'
        ? getHistory(visit)
        : getPhotos(visit)),
    });
  } catch {
    return jsonError(503, 'Photo history is unavailable.');
  }
}
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (wrongOrigin(req)) return jsonError(403, 'Invalid request origin.');
  const visit = await authorized((await params).id);
  if (visit instanceof Response) return visit;
  if (['completed', 'cancelled'].includes(visit.status))
    return jsonError(409, 'This visit has ended.');
  if (!photosConfigured()) return jsonError(503, 'Photo uploads are not configured.');
  if ((await getPhotos(visit)).length >= 30)
    return jsonError(429, 'Photo limit reached for this visit.');
  try {
    return json({ photo: await addPhoto(visit, await uploadPhoto(req), 'physician') });
  } catch {
    return jsonError(400, 'Photo upload failed. Please retry.');
  }
}
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (wrongOrigin(req)) return jsonError(403, 'Invalid request origin.');
  const visit = await authorized((await params).id);
  if (visit instanceof Response) return visit;
  try {
    const body = await req.json();
    if (
      typeof body.id !== 'string' ||
      typeof body.notes !== 'string' ||
      typeof body.diagnosis !== 'string' ||
      body.notes.length > 10000 ||
      body.diagnosis.length > 1000
    )
      return jsonError(400, 'Invalid photo notes.');
    const photo = await updatePhoto(visit, body.id, body.notes, body.diagnosis);
    return photo ? json({ photo }) : jsonError(404, 'Photo not found');
  } catch {
    return jsonError(503, 'Unable to save photo notes.');
  }
}
