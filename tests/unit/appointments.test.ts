import { describe, expect, it } from 'vitest';
import { localDate, buildAppointments, MODALITY_SYSTEM, planAppointments, toClinicSoftAppointment, toFhirAppointment } from '@/scripts/lib/appointments';
import { demoTelecom, pickDemoContacts } from '@/scripts/lib/demo-contacts';
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
    expect(starts).toContain('2026-11-07T16:15:00Z'); // now+10m, rounded up to 5 min
    expect(starts).toContain('2026-11-07T16:35:00Z'); // now+30m
    const soon = appts.filter((a) => a.start === '2026-11-07T16:15:00Z' || a.start === '2026-11-07T16:35:00Z');
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

describe('one plan, two EHR formats', () => {
  const plan = planAppointments(plan0());
  function plan0() {
    return { now, patientIds: ['p1', 'p2', 'p3', 'p4', 'p5'], practitionerIds: ['d1', 'd2', 'd3'], timeZone: TZ };
  }

  it('writes the same appointment to FHIR and to ClinicSoft', () => {
    const p = plan.find((x) => x.modality === 'telephone' && x.status === 'booked')!;
    const fhir = toFhirAppointment(p, now);
    const cs = toClinicSoftAppointment(p, TZ);
    expect(cs).toEqual({
      apptId: p.id,
      patientNo: p.patientId,
      providerNo: p.practitionerId,
      apptDate: localDate(p.start, TZ),
      startTime: new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(p.start),
      duration: 15,
      status: 'B',
      type: 'VIRT_PHONE',
      reason: p.reason,
    });
    expect(fhir.serviceType?.[0].coding?.[0]).toMatchObject({ system: MODALITY_SYSTEM, code: 'telephone' });
    expect(fhir.reasonCode).toEqual([{ text: p.reason }]);
    expect(fhir.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/); // no milliseconds, same as the adapter emits
  });

  it('codes cancelled and video appointments', () => {
    const cancelled = plan.find((x) => x.status === 'cancelled')!;
    expect(toClinicSoftAppointment(cancelled, TZ).status).toBe('C');
    const video = plan.find((x) => x.modality === 'video')!;
    expect(toClinicSoftAppointment(video, TZ).type).toBe('VIRT_VIDEO');
  });

  it('gives demo contacts to the first distinct patients booked today, phone i and email i together', () => {
    const phones = ['+16135550100', '+16135550101'];
    const emails = ['demo1@example.com', 'demo2@example.com', 'demo3@example.com'];
    const assigned = pickDemoContacts(plan, phones, emails, now, TZ);
    const todays = plan
      .filter((x) => x.status === 'booked' && localDate(x.start, TZ) === '2026-11-07')
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    const expected = [...new Set(todays.map((x) => x.patientId))].slice(0, 3);
    expect([...assigned.keys()]).toEqual(expected);
    expect([...assigned.values()]).toEqual([
      { phone: phones[0], email: emails[0] },
      { phone: phones[1], email: emails[1] },
      { email: emails[2] }, // more emails than phones: the third patient gets only an email
    ]);
    expect(pickDemoContacts(plan, [], [], now, TZ).size).toBe(0);
  });

  it('demo telecom: demo phone + email first, any other Synthea phone/email dropped', () => {
    const synthea = [
      { system: 'phone' as const, value: '555-123-4567', use: 'home' as const },
      { system: 'email' as const, value: 'someone@real.example' },
      { system: 'url' as const, value: 'https://example.org' },
    ];
    expect(demoTelecom(synthea, { phone: '+16135550100', email: 'demo1@example.com' })).toEqual([
      { system: 'phone', value: '+16135550100', use: 'mobile' },
      { system: 'email', value: 'demo1@example.com' },
      { system: 'url', value: 'https://example.org' },
    ]);
    expect(demoTelecom(synthea, undefined)).toEqual([{ system: 'url', value: 'https://example.org' }]);
  });
});
