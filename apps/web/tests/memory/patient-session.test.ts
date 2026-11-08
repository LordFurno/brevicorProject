import { beforeEach, describe, it, expect, vi } from 'vitest';
import { NextResponse } from 'next/server';
import type { Visit } from '../../src/lib/visits/types';
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
  }),
}));
import { getVisitStore } from '../../src/lib/visits/store';
import {
  authorizedPatient,
  setPatientCookie,
  setCallCookie,
  isPatientVerified,
} from '../../src/lib/auth/patient';
import { hashToken, newInviteToken } from '../../src/lib/visits/tokens';
import { rotateInvitation, admitVisit } from '../../src/lib/visits/service';
const save = (response: NextResponse) =>
  response.cookies.getAll().forEach((c) => jar.set(c.name, c.value));
let v: Visit, token: string;
beforeEach(async () => {
  jar.clear();
  token = newInviteToken('session-test');
  const now = new Date().toISOString();
  v = {
    id: crypto.randomUUID(),
    clinicId: 'session-test',
    appointmentRef: 'Appointment/a',
    patientRef: 'Patient/p',
    practitionerRef: 'Practitioner/d',
    modality: 'video',
    start: now,
    end: new Date(Date.now() + 900000).toISOString(),
    status: 'scheduled',
    appointmentStatus: 'booked',
    inviteTokenHash: hashToken(token),
    roomName: 'test-room',
    verifyAttempts: 0,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
  await getVisitStore().mutate(v.clinicId, v.id, () => ({ visit: v, events: [] }));
});
describe('patient invitation and call credentials', () => {
  it('requires a verified per-visit cookie and revokes that cookie on token rotation', async () => {
    expect(await authorizedPatient(token)).toBeNull();
    const res = NextResponse.json({});
    setPatientCookie(res, v);
    save(res);
    expect((await authorizedPatient(token))?.id).toBe(v.id);
    await rotateInvitation(getVisitStore(), v);
    expect(await authorizedPatient(token)).toBeNull();
    expect(await isPatientVerified((await getVisitStore().get(v.clinicId, v.id))!)).toBe(false);
  });
  it('retains only an already joined call after invitation rotation', async () => {
    v = (await admitVisit(v, Date.now(), getVisitStore()))!;
    const res = NextResponse.json({});
    setPatientCookie(res, v);
    setCallCookie(res, v, token);
    save(res);
    await rotateInvitation(getVisitStore(), v);
    expect(await authorizedPatient(token)).toBeNull();
    expect((await authorizedPatient(token, true))?.id).toBe(v.id);
    await getVisitStore().mutate(v.clinicId, v.id, (current) => ({
      visit: { ...current!, patientRef: 'Patient/other' },
      events: [],
    }));
    expect(await authorizedPatient(token, true)).toBeNull();
  });
});
