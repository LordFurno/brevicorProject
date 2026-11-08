import { getDoctor, ownsVisit } from '@/lib/auth/doctor';
import { createPhotoDocument } from '@/lib/clinical/write';
import { json, jsonError } from '@/lib/http';
import { linkEncounter, writeErrorCode } from '@/lib/visits/service';
import { getVisitStore } from '@/lib/visits/store';
import { chartImageUrl } from '@/media/photo-urls';
import { getPhotos, linkPhotoDocument } from '@/media/visit-photos';

// POST /api/doctor/visits/:id/photos/:photoId/chart — "Save to chart": file the
// photo (with its notes and diagnosis) to the patient's EHR chart as a
// DocumentReference, through the FHIR gateway with the physician's token.
export async function POST(req: Request, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  if (req.headers.has('origin') && req.headers.get('origin') !== new URL(req.url).origin)
    return jsonError(403, 'Invalid request origin.');
  const { id, photoId } = await params;
  const doctor = await getDoctor();
  if (!doctor) return jsonError(401, 'Unauthorized');
  const store = getVisitStore();
  const visit = await store.get(doctor.clinicId, id);
  if (!visit || !ownsVisit(doctor, visit)) return jsonError(404, 'Visit not found');
  if (visit.status === 'cancelled') return jsonError(409, 'This visit was cancelled.');

  let photo;
  try {
    photo = (await getPhotos(visit)).find((p) => p.id === photoId);
  } catch {
    return jsonError(503, 'Photo history is unavailable.');
  }
  if (!photo) return jsonError(404, 'Photo not found');
  if (photo.documentRef) return json({ photo, alreadySaved: true });

  const ctx = { clinicId: doctor.clinicId, accessToken: doctor.accessToken };
  // The DocumentReference links to the visit's Encounter; open it now if admitting couldn't.
  const linked = await linkEncounter(visit, ctx, store);
  const failed = async (errorCode: string) => {
    console.error('[photos] save to chart failed:', errorCode);
    await store
      .mutate(visit.clinicId, visit.id, (current) =>
        current ? { visit: current, events: [{ type: 'photo_chart_failed', actor: 'physician', meta: { photoId: photo.id, errorCode } }] } : null,
      )
      .catch(() => {});
  };

  let document;
  try {
    document = await createPhotoDocument(linked, photo, chartImageUrl(photo.id), ctx);
  } catch (e) {
    await failed(writeErrorCode(e));
    return jsonError(502, "Couldn't save to the clinic's chart. Please retry.");
  }
  try {
    const saved = await linkPhotoDocument(linked, photo.id, document.ref, document.syncStatus);
    if (!saved) return jsonError(404, 'Photo not found');
    return json({ photo: saved, syncStatus: document.syncStatus });
  } catch {
    // The chart has it; only Brevicor's record of the link failed.
    await failed('memory:unavailable');
    return jsonError(503, 'Saved to the chart, but Brevicor could not record it. Please refresh before retrying.');
  }
}
