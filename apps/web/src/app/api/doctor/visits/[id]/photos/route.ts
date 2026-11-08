import { getDoctor, ownsVisit } from '@/lib/auth/doctor';
import { getVisitStore } from '@/lib/visits/store';
import { getPhotos, addPhoto, photoContext, getHistory, updatePhoto } from '@/media/visit-photos';
import { uploadPhoto } from '@/media/upload-photo';

const headers = { 'Cache-Control': 'no-store' };
async function authorized(id: string) {
  const doctor = await getDoctor();
  if (!doctor) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const visit = await getVisitStore().get(id);
  if (!visit || !ownsVisit(doctor, visit)) return Response.json({ error: 'Visit not found' }, { status: 404 });
  return visit;
}
function wrongOrigin(req: Request) { return req.headers.has('origin') && req.headers.get('origin') !== new URL(req.url).origin; }
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params, visit = await authorized(id);
  if (visit instanceof Response) return visit;
  try { return Response.json({ photos: new URL(req.url).searchParams.get('history') === '1' ? getHistory(visit) : getPhotos(id) }, { headers }); }
  catch { return Response.json({ error: 'Photo history is unavailable.' }, { status: 503, headers }); }
}
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (wrongOrigin(req)) return Response.json({ error: 'Invalid request origin.' }, { status: 403 });
  const { id } = await params, visit = await authorized(id);
  if (visit instanceof Response) return visit;
  if (visit.status === 'completed' || visit.status === 'cancelled') return Response.json({ error: 'This visit has ended.' }, { status: 409 });
  try {
    if (getPhotos(id).length >= 30) return Response.json({ error: 'Photo limit reached for this visit.' }, { status: 429 });
    const photo = await uploadPhoto(req); addPhoto(id, photo, photoContext(visit));
    return Response.json({ photo }, { headers });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : 'Upload failed.' }, { status: 400 }); }
}
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (wrongOrigin(req)) return Response.json({ error: 'Invalid request origin.' }, { status: 403 });
  const { id } = await params, visit = await authorized(id);
  if (visit instanceof Response) return visit;
  try {
    const body = await req.json();
    if (typeof body.id !== 'string' || typeof body.notes !== 'string' || typeof body.diagnosis !== 'string' || body.notes.length > 10000 || body.diagnosis.length > 1000) return Response.json({ error: 'Invalid photo notes.' }, { status: 400 });
    const photo = updatePhoto(id, body.id, body.notes, body.diagnosis);
    return photo ? Response.json({ photo }, { headers }) : Response.json({ error: 'Photo not found' }, { status: 404 });
  } catch { return Response.json({ error: 'Unable to save photo notes.' }, { status: 503 }); }
}
