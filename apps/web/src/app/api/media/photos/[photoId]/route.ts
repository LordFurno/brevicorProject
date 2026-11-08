import { getDoctor } from '@/lib/auth/doctor';
import { jsonError } from '@/lib/http';
import { photosConfigured, signedDeliveryUrl, TRANSFORMATION_RE } from '@/media/cloudinary';
import { CHART_TRANSFORMATION, verifyPhotoGrant } from '@/media/photo-urls';
import { photoAsset } from '@/media/visit-photos';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/media/photos/:photoId
//   ?g=<grant>  a 5-minute signed grant issued to a physician who may see this
//               photo (POST /api/doctor/visits/:id/photos/urls), for one transformation.
//   (no grant)  the stable chart link: the original as JPEG, for a signed-in
//               physician of the photo's clinic.
// The image is fetched from Cloudinary (authenticated asset, signed URL) and
// streamed; the Cloudinary URL never reaches the browser.
export async function GET(req: Request, { params }: { params: Promise<{ photoId: string }> }) {
  const { photoId } = await params;
  if (!UUID.test(photoId)) return jsonError(404, 'Not found');
  if (!photosConfigured()) return jsonError(503, 'Photo storage is not configured.');

  const grant = new URL(req.url).searchParams.get('g');
  let transformation: string;
  let asset;
  if (grant !== null) {
    const allowed = verifyPhotoGrant(photoId, grant);
    if (allowed === null || !TRANSFORMATION_RE.test(allowed)) return jsonError(403, 'This photo link has expired. Reload the page.');
    transformation = allowed;
    asset = await photoAsset(photoId);
  } else {
    const doctor = await getDoctor();
    if (!doctor) return jsonError(401, 'Sign in to view this photo.');
    asset = await photoAsset(photoId);
    // Any clinic the physician belongs to, not just the one currently selected.
    if (asset && !doctor.memberships.some((m) => m.clinicId === asset!.clinicId)) asset = null;
    transformation = CHART_TRANSFORMATION;
  }
  if (!asset) return jsonError(404, 'Not found');

  let upstream: Response;
  try {
    upstream = await fetch(signedDeliveryUrl(asset.publicId, asset.version, transformation), {
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    return jsonError(502, 'Photo unavailable.');
  }
  if (!upstream.ok || !upstream.body) return jsonError(upstream.status === 404 ? 404 : 502, 'Photo unavailable.');
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
