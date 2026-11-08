import { describe, expect, it } from 'vitest';
import { localDate, buildAppointments, MODALITY_SYSTEM } from '@/scripts/lib/appointments';
import { validateResource } from '@/lib/fhir/validate';

const TZ = 'America/Toronto';
const now = new Date('2026-11-07T16:02:00Z'); // 11:02 in Toronto
const plan = { now, patientIds: ['p1', 'p2', 'p3', 'p4', 'p5'], practitionerIds: ['d1', 'd2', 'd3'], timeZone: TZ };

describe('buildAppointments', () => {
  const appts = buildAppointments(plan);

  it('makes ~20 valid R4 appointments over today and tomorrow (clinic-local)', () => {
    expect(appts).toHaveLength(20);
    for (const a of appts) expect(validateResource(a)).toEqual([]);
    const days = new Set(appts.map((a) => localDate(new Date(a.start!), TZ)));
    expect([...days].sort()).toEqual(['2026-11-07', '2026-11-08']);
  });

  it('includes bookings starting soon, for the waiting room', () => {
    const starts = appts.map((a) => a.start);
    expect(starts).toContain('2026-11-07T16:15:00.000Z'); // now+10m, rounded up to 5 min
    expect(starts).toContain('2026-11-07T16:35:00.000Z'); // now+30m
    const soon = appts.filter((a) => a.start === '2026-11-07T16:15:00.000Z' || a.start === '2026-11-07T16:35:00.000Z');
    expect(soon.every((a) => a.status === 'booked')).toBe(true);
  });

  it('is mostly booked with a few cancelled (R4 cancelationReason)', () => {
    const cancelled = appts.filter((a) => a.status === 'cancelled');
    expect(cancelled.length).toBeGreaterThanOrEqual(2);
    expect(cancelled.length).toBeLessThanOrEqual(3);
    expect(appts.filter((a) => a.status === 'booked').length).toBe(20 - cancelled.length);
    for (const a of cancelled) expect(a.cancelationReason?.text).toBeTruthy();
  });

  it('links a Patient and a Practitioner and marks the modality', () => {
    for (const a of appts) {
      const refs = a.participant.map((p) => p.actor?.reference);
      expect(refs[0]).toMatch(/^Patient\/p\d$/);
      expect(refs[1]).toMatch(/^Practitioner\/d\d$/);
      expect(['video', 'telephone']).toContain(a.serviceType?.[0].coding?.[0].code);
      expect(a.serviceType?.[0].coding?.[0].system).toBe(MODALITY_SYSTEM);
    }
    const codes = appts.map((a) => a.serviceType?.[0].coding?.[0].code);
    expect(codes.filter((c) => c === 'telephone').length).toBeGreaterThan(0);
    expect(codes.filter((c) => c === 'video').length).toBeGreaterThan(codes.length / 2);
  });

  it('is deterministic for a given day and unique by id', () => {
    expect(buildAppointments(plan)).toEqual(appts);
    expect(new Set(appts.map((a) => a.id)).size).toBe(appts.length);
  });
});
