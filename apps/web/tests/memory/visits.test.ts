import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { Appointment } from 'fhir/r4';
import { MemoryVisitStore, toRow } from '../../src/lib/visits/store';
import { syncVisits } from '../../src/lib/visits/sync';
import { hashToken, newInviteToken, appointmentVisitId } from '../../src/lib/visits/tokens';
import {
  checkInAndGetStatus,
  rotateInvitation,
  verifyPatient,
  admitVisit,
  endVisit,
} from '../../src/lib/visits/service';
import { GatewayError } from '../../src/lib/clinical/gateway';
const now = Date.parse('2026-11-08T15:00:00Z'),
  clinic = 'test-clinic';
function appointment(patch: Partial<Appointment> = {}): Appointment {
  return {
    resourceType: 'Appointment',
    id: 'appt-1',
    status: 'booked',
    start: new Date(now + 5 * 60000).toISOString(),
    end: new Date(now + 20 * 60000).toISOString(),
    participant: [
      { actor: { reference: 'Patient/p1' }, status: 'accepted' },
      { actor: { reference: 'Practitioner/d1' }, status: 'accepted' },
    ],
    serviceType: [
      {
        coding: [
          { system: 'https://brevicor.ca/fhir/CodeSystem/consultation-modality', code: 'video' },
        ],
      },
    ],
    ...patch,
  };
}
let store: MemoryVisitStore, items: Appointment[], jobs: (() => Promise<unknown>)[];
const range = { from: '2026-11-08', to: '2026-11-23' };
const sync = () =>
  syncVisits(clinic, range, {
    store,
    search: async () => items,
    dispatch: (job) => {
      jobs.push(job);
    },
  });
const get = () => store.get(clinic, appointmentVisitId(clinic, 'Appointment/appt-1'));
beforeEach(() => {
  store = new MemoryVisitStore();
  items = [appointment()];
  jobs = [];
  vi.stubEnv('APP_BASE_URL', 'http://localhost:3000');
});
describe('appointment synchronization', () => {
  it('creates a reference-only visit, an invitation, and idempotent events', async () => {
    expect((await sync()).created).toBe(1);
    const v = (await get())!;
    expect(v).toMatchObject({
      patientRef: 'Patient/p1',
      practitionerRef: 'Practitioner/d1',
      status: 'scheduled',
      modality: 'video',
    });
    expect(v.inviteTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(jobs).toHaveLength(1);
    await sync();
    expect(jobs).toHaveLength(1);
    expect(store.events.filter((e) => e.type === 'invited')).toHaveLength(1);
    expect(
      Object.keys(
        toRow({ ...v, patient: { name: 'Must not persist' }, inviteToken: 'secret' } as typeof v),
      ),
    ).not.toContain('patient');
    expect(JSON.stringify(v)).not.toContain('Must not persist');
  });
  it('serializes simultaneous syncs into one invitation', async () => {
    await Promise.all([sync(), sync(), sync()]);
    expect(jobs).toHaveLength(1);
    expect(store.events.filter((e) => e.type === 'invited')).toHaveLength(1);
  });
  it('reschedules, rotates the hash, and resets a waiting patient', async () => {
    await sync();
    let v = (await get())!;
    await checkInAndGetStatus(store, v, now, () => {});
    const old = v.inviteTokenHash;
    items = [
      appointment({
        start: new Date(now + 3600000).toISOString(),
        end: new Date(now + 4500000).toISOString(),
      }),
    ];
    expect((await sync()).rescheduled).toBe(1);
    v = (await get())!;
    expect(v.status).toBe('scheduled');
    expect(v.waitingSince).toBeUndefined();
    expect(v.inviteTokenHash).not.toBe(old);
  });
  it('cancels waiting visits and never invites already cancelled appointments', async () => {
    items = [appointment({ status: 'cancelled' })];
    await sync();
    expect((await get())?.status).toBe('cancelled');
    expect(jobs).toHaveLength(0);
  });
  it('preserves an active call when the EHR cancels and blocks further admission', async () => {
    await sync();
    let v = (await get())!;
    v = (await admitVisit(v, now, store))!;
    items = [appointment({ status: 'cancelled' })];
    expect((await sync()).cancelled).toBe(1);
    v = (await get())!;
    expect(v.status).toBe('in_progress');
    expect(v.appointmentStatus).toBe('cancelled');
    expect(await admitVisit(v, now, store)).toBeNull();
    expect((await endVisit(v, now + 60000, store))?.status).toBe('completed');
  });
  it('ignores non-telemedicine and unconfirmed appointments', async () => {
    items = [appointment({ serviceType: [] }), appointment({ id: 'pending', status: 'pending' })];
    expect((await sync()).ignored).toBe(2);
    expect(await get()).toBeNull();
  });
  it('maps telephone to phone', async () => {
    items[0].serviceType![0].coding![0].code = 'telephone';
    await sync();
    expect((await get())?.modality).toBe('phone');
  });
  it('never lets notification HTTP or configuration failures break sync', async () => {
    vi.stubEnv('NOTIFY_API_URL', 'http://notify.test/api/notify/v1');
    vi.stubEnv('INTERNAL_SERVICE_TOKEN', 'test-token');
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 503 }));
    try {
      expect(
        (
          await syncVisits(clinic, range, {
            store,
            search: async () => items,
            dispatch: (job) => job(),
          })
        ).created,
      ).toBe(1);
      expect(store.events.some((e) => e.type === 'notification_failed')).toBe(true);
      const body = JSON.parse(fetch.mock.calls[0][1]!.body as string);
      expect(body.dedupeKey).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);
    } finally {
      fetch.mockRestore();
    }
    store = new MemoryVisitStore();
    vi.stubEnv('APP_BASE_URL', '');
    expect(
      (
        await syncVisits(clinic, range, {
          store,
          search: async () => items,
          dispatch: (job) => job(),
        })
      ).created,
    ).toBe(1);
  });
  it('re-reads appointments moved outside the search window without assuming cancellation', async () => {
    await sync();
    const summary = await syncVisits(clinic, range, {
      store,
      search: async () => [],
      read: async () => {
        throw new GatewayError(404);
      },
      dispatch: () => {},
    });
    expect(summary.unavailable).toBe(1);
    expect((await get())?.status).toBe('scheduled');
    await syncVisits(clinic, range, {
      store,
      search: async () => [],
      read: async () => appointment({ start: '2026-12-01T15:00:00Z', end: '2026-12-01T15:15:00Z' }),
      dispatch: () => {},
    });
    expect((await get())?.start).toContain('2026-12-01');
  });
});
describe('visit activity', () => {
  it('mints compact invitations with 160 bits of randomness', () => {
    expect(newInviteToken('demo-clinicsoft')).toMatch(/^demo-clinicsoft\.[A-Za-z0-9_-]{27}$/);
  });
  it('rotates links and scopes reads to the clinic', async () => {
    await sync();
    const v = (await get())!,
      old = await rotateInvitation(store, v),
      next = await rotateInvitation(store, v);
    expect(await store.getByToken(old!)).toBeNull();
    expect((await store.getByToken(next!))?.id).toBe(v.id);
    expect(await store.get('other', v.id)).toBeNull();
    expect(hashToken(next!)).toBe((await get())?.inviteTokenHash);
  });
  it('records one arrival under concurrent heartbeats', async () => {
    await sync();
    const v = (await get())!;
    await Promise.all(
      Array.from({ length: 8 }, () => checkInAndGetStatus(store, v, now, () => {})),
    );
    expect(store.events.filter((e) => e.type === 'checked_in')).toHaveLength(1);
  });
  it('keeps check-in working if notification scheduling fails', async () => {
    await sync();
    expect(
      (
        await checkInAndGetStatus(store, (await get())!, now, () => {
          throw new Error('scheduler unavailable');
        })
      ).phase,
    ).toBe('waiting');
  });
  it('enforces the five-attempt limit under concurrent verification', async () => {
    await sync();
    const v = (await get())!,
      token = await rotateInvitation(store, v);
    await Promise.all(
      Array.from({ length: 8 }, () =>
        verifyPatient(store, v, token!, '2000-01-01', async () => ({
          resourceType: 'Patient',
          birthDate: '1990-01-01',
        })),
      ),
    );
    expect((await get())?.verifyAttempts).toBe(5);
    expect(store.events.filter((e) => e.type === 'verify_failed')).toHaveLength(5);
  });
  it('does not charge attempts for a gateway outage', async () => {
    await sync();
    const v = (await get())!;
    await expect(
      verifyPatient(store, v, newInviteToken(clinic), '2000-01-01', async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
    expect((await get())?.verifyAttempts).toBe(0);
  });
  it('rejects physician actions after ownership changes during a request', async () => {
    await sync();
    const v = (await get())!;
    await store.mutate(clinic, v.id, (current) => ({
      visit: { ...current!, practitionerRef: 'Practitioner/new-doctor' },
      events: [],
    }));
    expect(await admitVisit(v, now, store)).toBeNull();
    expect(await endVisit(v, now, store)).toBeNull();
    expect(await rotateInvitation(store, v)).toBeNull();
  });
  it('does not invite or reopen completed visits when appointment times change', async () => {
    await sync();
    const v = (await get())!;
    await endVisit(v, now, store);
    jobs = [];
    items = [
      appointment({
        start: new Date(now + 3600000).toISOString(),
        end: new Date(now + 4500000).toISOString(),
      }),
    ];
    await sync();
    expect((await get())?.status).toBe('completed');
    expect(jobs).toHaveLength(0);
  });
  it('rejects PHI fields in event metadata and strips unknown persistence fields', async () => {
    await sync();
    const v = (await get())!;
    await expect(
      store.mutate(clinic, v.id, (c) => ({
        visit: c!,
        events: [{ type: 'synced', actor: 'system', meta: { name: 'forbidden' } }],
      })),
    ).rejects.toThrow('Invalid audit metadata');
    expect(toRow({ ...v, inviteToken: 'raw' } as typeof v)).not.toHaveProperty('inviteToken');
  });
});
