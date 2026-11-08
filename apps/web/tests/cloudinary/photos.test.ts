import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Visit } from '../../src/lib/visits/types';

const auth = vi.hoisted(() => ({
  doctor: null as object | null, owns: false, verified: false,
  visit: { id: 'photo-test-visit', clinicId: 'photo-test-clinic', patientRef: 'Patient/photo-test', status: 'in_progress' },
}));
vi.mock('@/lib/auth/doctor', () => ({ getDoctor: async () => auth.doctor, ownsVisit: () => auth.owns }));
vi.mock('@/lib/auth/patient', () => ({ authorizedPatient: async () => auth.verified ? auth.visit : null }));
vi.mock('@/lib/visits/store', () => ({ getVisitStore: () => ({ get: async () => auth.visit, getByToken: async () => auth.visit }) }));

import { GET } from '../../src/app/api/doctor/visits/[id]/photos/route';
import { POST } from '../../src/app/api/visit/[token]/photos/route';
import { addPhoto } from '../../src/media/visit-photos';
import { getEnhancedImage } from '../../src/components/cloudinary/enhancements';

const doctorParams = { params: Promise.resolve({ id: 'photo-test-visit' }) };
const patientParams = { params: Promise.resolve({ token: 'test-token' }) };

beforeEach(() => {
  auth.doctor = null; auth.owns = false; auth.verified = false;
  auth.visit = { id: 'photo-test-visit', clinicId: 'photo-test-clinic', patientRef: 'Patient/photo-test', status: 'in_progress' };
  vi.stubEnv('NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME', 'demo');
  vi.stubEnv('NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET', 'unsigned');
});

describe('visit photo access', () => {
  it('requires doctor authentication', async () => {
    expect((await GET(new Request('http://localhost/api/photos'), doctorParams)).status).toBe(401);
  });
  it('does not expose another physician’s visit', async () => {
    auth.doctor = {};
    expect((await GET(new Request('http://localhost/api/photos'), doctorParams)).status).toBe(404);
  });
  it('returns only photos belonging to the authorized visit', async () => {
    auth.doctor = {}; auth.owns = true;
    await addPhoto({ ...auth.visit, id: 'other-visit' } as Visit, { id: 'other', publicId: 'private-other-photo', notes: '', createdAt: new Date().toISOString() });
    const result = await GET(new Request('http://localhost/api/photos'), doctorParams);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ photos: [] });
    expect(result.headers.get('Cache-Control')).toBe('no-store');
  });
  it('requires patient verification', async () => {
    const result = await POST(new Request('http://localhost/api/photos', { method: 'POST' }), patientParams);
    expect(result.status).toBe(401);
  });
  it('rejects cross-origin patient uploads', async () => {
    auth.verified = true;
    const result = await POST(new Request('http://localhost/api/photos', { method: 'POST', headers: { origin: 'https://unrelated.example' } }), patientParams);
    expect(result.status).toBe(403);
  });
  it('rejects photos after the visit ends', async () => {
    auth.verified = true; auth.visit.status = 'completed';
    expect((await POST(new Request('http://localhost/api/photos', { method: 'POST' }), patientParams)).status).toBe(409);
  });
  it('rejects unsupported media without contacting Cloudinary', async () => {
    auth.verified = true;
    const form = new FormData(); form.append('file', new File(['test'], 'test.txt', { type: 'text/plain' }));
    expect((await POST(new Request('http://localhost/api/photos', { method: 'POST', body: form }), patientParams)).status).toBe(400);
  });
  it('shares a successful upload with the owning physician', async () => {
    auth.verified = true; auth.doctor = {}; auth.owns = true;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ public_id: 'uploaded/photo' }));
    try {
      const form = new FormData(); form.append('file', new File(['photo'], 'photo.png', { type: 'image/png' }));
      expect((await POST(new Request('http://localhost/api/photos', { method: 'POST', body: form }), patientParams)).status).toBe(200);
      const result = await GET(new Request('http://localhost/api/photos'), doctorParams);
      const data = await result.json();
      expect(data.photos).toHaveLength(1);
      expect(data.photos[0].publicId).toBe('uploaded/photo');
    } finally { fetchMock.mockRestore(); }
  });
});

describe('Cloudinary delivery', () => {
  it('uses smaller eco images in low-data mode while preserving the full frame', () => {
    const url = getEnhancedImage('test/photo', { filter: 'raw', lowDataMode: true }).toURL();
    expect(url).toContain('q_auto:eco'); expect(url).toContain('f_auto'); expect(url).toContain('w_640');
    expect(url).not.toContain('c_fill'); expect(url).not.toContain('e_improve');
  });
  it('keeps normal resolution outside low-data mode', () => {
    const url = getEnhancedImage('test/photo', { filter: 'auto_enhance' }).toURL();
    expect(url).toContain('w_1280'); expect(url).not.toContain('q_auto:eco');
    expect(url).toContain('e_improve'); expect(url).toContain('e_sharpen:20');
  });
});
