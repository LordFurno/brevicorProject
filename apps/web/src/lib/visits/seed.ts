import { randomBytes } from 'crypto';
import type { Visit, VisitPatient, VisitStatus } from './types';

// Demo appointments relative to "now", so the dashboard always looks alive.
// Patient details match the synthetic FHIR records in lib/clinical/mock-data.ts.

const SLOT_MS = 20 * 60_000;

const P = {
  daniel: { name: 'Daniel Okafor', dateOfBirth: '1975-09-02', healthCardNumber: '4532281946', email: 'daniel.o@example.com' },
  maya: { name: 'Maya Thompson', dateOfBirth: '1988-03-14', healthCardNumber: '4821937560', phone: '+14165550193' },
  priya: { name: 'Priya Raman', dateOfBirth: '1993-06-21', healthCardNumber: '5729104483', email: 'priya.r@example.com' },
  sofia: { name: 'Sofia Martinez', dateOfBirth: '2001-01-08', healthCardNumber: '6140392718', email: 'sofia.m@example.com' },
  robert: { name: 'Robert Gagnon', dateOfBirth: '1952-11-30', healthCardNumber: '3318726605', phone: '+16135550144' },
} satisfies Record<string, VisitPatient>;

export function demoVisits(now = Date.now()): Visit[] {
  const base = Math.floor(now / SLOT_MS) * SLOT_MS;
  const iso = (ms: number) => new Date(ms).toISOString();

  const mk = (
    practitionerId: string,
    clinicId: string,
    slot: number,
    patient: VisitPatient,
    reason: string,
    status: VisitStatus,
    extra: Partial<Visit> = {},
  ): Visit => {
    const id = `v_${randomBytes(5).toString('hex')}`;
    const start = base + slot * SLOT_MS;
    return {
      id,
      clinicId,
      practitionerId,
      start: iso(start),
      end: iso(start + SLOT_MS),
      reason,
      patient,
      inviteToken: randomBytes(24).toString('base64url'),
      roomName: `brevicor-${id}`,
      status,
      createdAt: iso(now - 3 * 86_400_000),
      verifyAttempts: 0,
      ...extra,
    };
  };

  return [
    mk('pr-chen', 'riverside', -5, P.robert, 'Prescription renewals, and a question about ongoing knee pain.', 'completed', {
      admittedAt: iso(base - 5 * SLOT_MS + 2 * 60_000),
      endedAt: iso(base - 5 * SLOT_MS + 16 * 60_000),
    }),
    mk('pr-chen', 'riverside', -2, P.daniel, 'Morning blood sugar readings have been higher than usual this week. Would like to review my medications.', 'waiting', {
      simulated: true,
      waitingSince: iso(now - 23 * 60_000),
    }),
    mk('pr-chen', 'riverside', -1, P.maya, 'Cough that won’t go away for about two weeks, worse at night. Using my inhaler more often than usual.', 'waiting', {
      simulated: true,
      waitingSince: iso(now - 6 * 60_000),
    }),
    // Not simulated: open this patient's link from the dashboard to try the real flow (DOB 1993-06-21).
    mk('pr-chen', 'riverside', 0, P.priya, 'Follow-up on my iron levels — still feeling tired and getting more headaches lately.', 'scheduled'),
    mk('pr-chen', 'riverside', 3, P.sofia, 'Check-in about my anxiety medication. Sleeping better but noticing some side effects.', 'scheduled'),
    mk('pr-osei', 'riverside', 1, P.robert, 'Follow-up on blood pressure readings.', 'scheduled'),
  ];
}
