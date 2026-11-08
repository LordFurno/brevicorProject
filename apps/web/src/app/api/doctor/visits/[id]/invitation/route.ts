import { getDoctor, ownsVisit } from '@/lib/auth/doctor';
import { json, jsonError } from '@/lib/http';
import { getVisitStore } from '@/lib/visits/store';
import { rotateInvitation } from '@/lib/visits/service';
import { appLink } from '@/lib/notify';
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url).origin)
    return jsonError(403, 'Invalid request origin');
  const doctor = await getDoctor();
  if (!doctor) return jsonError(401, 'Unauthorized');
  const { id } = await params,
    store = getVisitStore(),
    visit = await store.get(doctor.clinicId, id);
  if (!visit || !ownsVisit(doctor, visit)) return jsonError(404, 'Visit not found');
  const token = await rotateInvitation(store, visit);
  if (!token) return jsonError(409, 'Visit is closed');
  return json({ link: appLink(`/visit/${token}`) });
}
