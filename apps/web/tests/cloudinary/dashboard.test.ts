import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Visit } from '../../src/lib/visits/types';
import type { Practitioner } from '../../src/lib/directory';

const fixture = vi.hoisted(() => ({ previous: [] as Visit[], current: [] as Visit[], upcoming: [] as Visit[], query: vi.fn() }));
vi.mock('@/lib/visits/store', () => ({ getVisitStore: () => ({ list: fixture.query }) }));
vi.mock('@/lib/visits/service', () => ({ listDayForPractitioner: async () => fixture.current, listUpcomingForPractitioner: async () => fixture.upcoming }));
import { loadDoctorSchedule } from '../../src/scheduling/doctor-schedule';

const practitioner = { id: 'doctor-a', clinicId: 'clinic-a' } as Practitioner;
const now = Date.parse('2026-11-08T05:05:00Z'); // 00:05 in Toronto.
const row = (id: string, status: Visit['status'], start = '2026-11-08T04:40:00Z') => ({ id, status, start } as Visit);
beforeEach(() => {
  fixture.current = []; fixture.previous = []; fixture.upcoming = [];
  fixture.query.mockReset().mockImplementation(async () => fixture.previous);
});
describe('physician waiting room across midnight', () => {
  it('keeps patients waiting from the previous day visible', async () => {
    fixture.previous = [row('waiting-before-midnight', 'waiting')];
    expect((await loadDoctorSchedule(practitioner, now)).visits.map((v) => v.id)).toEqual(['waiting-before-midnight']);
  });
  it('retains ongoing calls but excludes completed, cancelled, and unstarted old appointments', async () => {
    fixture.previous = [row('call', 'in_progress'), row('done', 'completed'), row('cancelled', 'cancelled'), row('old-slot', 'scheduled')];
    expect((await loadDoctorSchedule(practitioner, now)).visits.map((v) => v.id)).toEqual(['call']);
  });
  it('keeps today and upcoming bookings intact', async () => {
    fixture.previous = [row('overnight', 'waiting')];
    fixture.current = [row('today', 'scheduled', '2026-11-08T15:00:00Z')];
    fixture.upcoming = [row('tomorrow', 'scheduled', '2026-11-09T15:00:00Z')];
    const result = await loadDoctorSchedule(practitioner, now);
    expect(result.visits.map((v) => v.id)).toEqual(['overnight', 'today']);
    expect(result.upcoming.map((v) => v.id)).toEqual(['tomorrow']);
  });
  it('scopes the previous-day query to this physician and clinic in Toronto time', async () => {
    await loadDoctorSchedule(practitioner, now);
    expect(fixture.query).toHaveBeenCalledWith({ clinicId: 'clinic-a', practitionerRef: 'Practitioner/doctor-a', from: '2026-11-07T05:00:00.000Z', to: '2026-11-08T05:00:00.000Z' });
  });
});
