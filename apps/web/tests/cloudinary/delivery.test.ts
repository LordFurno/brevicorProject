import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Visit } from '../../src/lib/visits/types';

const auth = vi.hoisted(() => ({
  doctor: null as null | { clinicId: string; memberships: { clinicId: string }[] },
  owns: true,
  visit: { id: 'delivery-visit', clinicId: 'delivery-clinic', patientRef: 'Patient/delivery', practitionerRef: 'Practitioner/d1', status: 'in_progress' },
}));
vi.mock('@/lib/auth/doctor', () => ({ getDoctor: async () => auth.doctor, ownsVisit: () => auth.owns }));
vi.mock('@/lib/visits/store', () => ({ getVisitStore: () => ({ get: async () => auth.visit }) }));

import { GET as media } from '../../src/app/api/media/photos/[photoId]/route';
import { POST as signUrls } from '../../src/app/api/doctor/visits/[id]/photos/urls/route';
import { transformationFor } from '../../src/components/cloudinary/enhancements';
import { signedDeliveryUrl } from '../../src/media/cloudinary';
import { PHOTO_URL_TTL_MS, signedPhotoUrl, verifyPhotoGrant } from '../../src/media/photo-urls';
import { addPhoto } from '../../src/media/visit-photos';

const PHOTO = '0b6f1c1e-1111-4222-8333-944455556666';
const OTHER = '0b6f1c1e-1111-4222-8333-000000000000';

beforeEach(async () => {
  vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'demo');
  vi.stubEnv('CLOUDINARY_API_KEY', 'test-key');
  vi.stubEnv('CLOUDINARY_API_SECRET', 'test-secret');
  auth.doctor = null;
  auth.owns = true;
  await addPhoto(auth.visit as Visit, { id: PHOTO, publicId: 'brevicor/asset-1', version: 7, notes: '', createdAt: new Date().toISOString() });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const params = (photoId: string) => ({ params: Promise.resolve({ photoId }) });

describe('short-lived photo URLs', () => {
  it('point at Brevicor, carry no Cloudinary or patient details, and expire after 5 minutes', () => {
    const url = signedPhotoUrl(PHOTO, 'f_auto');
    expect(url).toMatch(new RegExp(`^/api/media/photos/${PHOTO}\\?g=`));
    expect(url).not.toMatch(/cloudinary|asset-1|Patient/);
    const grant = new URL(url, 'http://x').searchParams.get('g');
    expect(verifyPhotoGrant(PHOTO, grant)).toBe('f_auto');
    expect(verifyPhotoGrant(OTHER, grant)).toBeNull();
    const old = new URL(signedPhotoUrl(PHOTO, 'f_auto', Date.now() - PHOTO_URL_TTL_MS - 1), 'http://x').searchParams.get('g');
    expect(verifyPhotoGrant(PHOTO, old)).toBeNull();
  });

  it('signs authenticated Cloudinary delivery on the server only', () => {
    const url = signedDeliveryUrl('brevicor/asset-1', 7, 'f_jpg,q_auto');
    expect(url).toMatch(/^https:\/\/res\.cloudinary\.com\/demo\/image\/authenticated\/s--[A-Za-z0-9_-]{8}--\/f_jpg,q_auto\/v7\/brevicor\/asset-1$/);
    expect(() => signedDeliveryUrl('brevicor/asset-1', 7, 'a b"<script>')).toThrow();
  });

  it('composes transformations in the browser without any asset id', () => {
    const t = transformationFor({ filter: 'raw', lowDataMode: true });
    expect(t).toContain('q_auto:eco');
    expect(t).not.toContain('placeholder');
  });
});

describe('media route', () => {
  it('streams the photo for a valid grant, privately, without revealing the Cloudinary URL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('jpeg-bytes', { headers: { 'content-type': 'image/jpeg' } }));
    const res = await media(new Request(`http://localhost${signedPhotoUrl(PHOTO, 'f_auto')}`), params(PHOTO));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('jpeg-bytes');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/image/authenticated/s--');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v7/brevicor/asset-1');
  });

  it('refuses expired or foreign grants', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const expired = signedPhotoUrl(PHOTO, 'f_auto', Date.now() - PHOTO_URL_TTL_MS - 1);
    expect((await media(new Request(`http://localhost${expired}`), params(PHOTO))).status).toBe(403);
    const forOther = signedPhotoUrl(PHOTO, 'f_auto').replace(PHOTO, OTHER);
    expect((await media(new Request(`http://localhost${forOther}`), params(OTHER))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the chart link needs a signed-in physician of the photo clinic', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('jpeg', { headers: { 'content-type': 'image/jpeg' } }));
    expect((await media(new Request(`http://localhost/api/media/photos/${PHOTO}`), params(PHOTO))).status).toBe(401);
    auth.doctor = { clinicId: 'elsewhere', memberships: [{ clinicId: 'elsewhere' }] };
    expect((await media(new Request(`http://localhost/api/media/photos/${PHOTO}`), params(PHOTO))).status).toBe(404);
    auth.doctor = { clinicId: 'elsewhere', memberships: [{ clinicId: 'elsewhere' }, { clinicId: 'delivery-clinic' }] };
    const ok = await media(new Request(`http://localhost/api/media/photos/${PHOTO}`), params(PHOTO));
    expect(ok.status).toBe(200);
  });
});

describe('URL signing endpoint', () => {
  it("signs only photos in the visit patient's history", async () => {
    auth.doctor = { clinicId: 'delivery-clinic', memberships: [{ clinicId: 'delivery-clinic' }] };
    const res = await signUrls(
      new Request('http://localhost/api/doctor/visits/delivery-visit/photos/urls', {
        method: 'POST',
        body: JSON.stringify({ items: [{ photoId: PHOTO, t: 'f_auto' }, { photoId: OTHER, t: 'f_auto' }] }),
      }),
      { params: Promise.resolve({ id: 'delivery-visit' }) },
    );
    expect(res.status).toBe(200);
    const { urls } = await res.json();
    expect(Object.keys(urls)).toEqual([`${PHOTO}|f_auto`]);
  });

  it('rejects malformed transformations', async () => {
    auth.doctor = { clinicId: 'delivery-clinic', memberships: [{ clinicId: 'delivery-clinic' }] };
    const res = await signUrls(
      new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ items: [{ photoId: PHOTO, t: '<script>' }] }) }),
      { params: Promise.resolve({ id: 'delivery-visit' }) },
    );
    expect(res.status).toBe(400);
  });
});
