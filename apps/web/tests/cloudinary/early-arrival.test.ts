import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Visit } from '../../src/lib/visits/types';
const fixture = vi.hoisted(() => ({ verified: true, update: vi.fn(), status: vi.fn(), visit: { id: 'early-visit', status: 'scheduled', start: '2026-11-08T15:00:00Z' } }));
vi.mock('@/lib/auth/patient', () => ({ isPatientVerified: async () => fixture.verified }));
vi.mock('@/lib/visits/store', () => ({ getVisitStore: () => ({ getByToken: async () => fixture.visit, update: fixture.update }) }));
vi.mock('@/lib/visits/service', () => ({ checkInAndGetStatus: fixture.status, toDoctorView: (v: Visit) => ({ id: v.id, status: v.status, present: false }) }));
import { hasEarlyArrival, toScheduleView } from '../../src/scheduling/doctor-view';
import { POST } from '../../src/app/api/visit/[token]/status/route';

const now = Date.parse('2026-11-08T05:20:00Z');
beforeEach(() => { fixture.verified = true; fixture.update.mockReset(); fixture.status.mockReset().mockResolvedValue({ phase: 'too_early', canEnterAt: '2026-11-08T14:45:00Z' }); });
describe('early arrival visibility', () => {
  it('shows a verified online patient as arrived early without changing booked status', () => {
    const v = { ...fixture.visit, lastSeenAt: new Date(now - 3000).toISOString() } as Visit;
    expect(toScheduleView(v, now)).toMatchObject({ status: 'scheduled', arrivedEarly: true, present: true });
  });
  it('does not show booked patients who have never opened the visit', () => {
    expect(hasEarlyArrival(fixture.visit as Visit, now)).toBe(false);
  });
  it('expires early presence when the patient closes their page', () => {
    expect(hasEarlyArrival({ ...fixture.visit, lastSeenAt: new Date(now - 21000).toISOString() } as Visit, now)).toBe(false);
  });
  it('records a heartbeat but preserves the too-early response and scheduled status', async () => {
    const response = await POST(new Request('http://localhost/status', { method: 'POST' }), { params: Promise.resolve({ token: 'test-token' }) });
    expect((await response.json()).phase).toBe('too_early');
    expect(fixture.update).toHaveBeenCalledWith('early-visit', { lastSeenAt: expect.any(String) });
    expect(fixture.visit.status).toBe('scheduled');
  });
  it('does not announce an unverified patient', async () => {
    fixture.verified = false;
    const response = await POST(new Request('http://localhost/status', { method: 'POST' }), { params: Promise.resolve({ token: 'test-token' }) });
    expect(response.status).toBe(401); expect(fixture.update).not.toHaveBeenCalled();
  });
  it('lets normal check-in handle patients after the waiting room opens', async () => {
    fixture.status.mockResolvedValue({ phase: 'waiting' });
    const response = await POST(new Request('http://localhost/status', { method: 'POST' }), { params: Promise.resolve({ token: 'test-token' }) });
    expect((await response.json()).phase).toBe('waiting'); expect(fixture.update).not.toHaveBeenCalled();
  });
});
