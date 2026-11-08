import { getDoctor, ownsVisit } from '@/lib/auth/doctor';
import { json, jsonError, wrongOrigin } from '@/lib/http';
import { getVisitStore } from '@/lib/visits/store';
import { TRANSFORMATION_RE } from '@/media/cloudinary';
import { signedPhotoUrl } from '@/media/photo-urls';
import { getHistory } from '@/media/visit-photos';

const MAX_ITEMS = 60;

// POST /api/doctor/visits/:id/photos/urls  { items: [{ photoId, t }] }
// Short-lived (5 min) viewing URLs for this patient's photos. The assigned
// visit authorizes the patient's clinic-wide photo history, as for GET photos.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (wrongOrigin(req)) return jsonError(403, 'Invalid request origin.');
  const doctor = await getDoctor();
  if (!doctor) return jsonError(401, 'Unauthorized');
  const visit = await getVisitStore().get(doctor.clinicId, (await params).id);
  if (!visit || !ownsVisit(doctor, visit)) return jsonError(404, 'Visit not found');

  let items: { photoId: string; t: string }[];
  try {
    const body = await req.json();
    items = body.items;
    if (
      !Array.isArray(items) ||
      items.length > MAX_ITEMS ||
      !items.every((i) => typeof i?.photoId === 'string' && typeof i?.t === 'string' && TRANSFORMATION_RE.test(i.t))
    )
      return jsonError(400, 'Invalid photo request.');
  } catch {
    return jsonError(400, 'Invalid photo request.');
  }

  let allowed: Set<string>;
  try {
    allowed = new Set((await getHistory(visit)).map((p) => p.id));
  } catch {
    return jsonError(503, 'Photo history is unavailable.');
  }
  const urls: Record<string, string> = {};
  for (const { photoId, t } of items) {
    if (allowed.has(photoId)) urls[`${photoId}|${t}`] = signedPhotoUrl(photoId, t);
  }
  return json({ urls });
}
