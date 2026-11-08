import { describe, expect, it } from 'vitest';
import { formatVisitTime, patientWaiting, visitCancelled, visitInvitation, visitRescheduled, type RenderedMessage } from '@/lib/notify/templates';

const LINK = `https://app.brevicor.ca/visit/${'a'.repeat(32)}`; // a real invitation link's length
const START = '2026-11-10T20:30:00Z'; // Tue Nov 10, 3:30 p.m. EST

// GSM 03.38 basic character set: anything else makes Twilio use 70-character UCS-2 segments.
const GSM7 = /^[A-Za-z0-9 @£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà]*$/;

function all(): [string, RenderedMessage][] {
  const out: [string, RenderedMessage][] = [['patient_waiting', patientWaiting({ link: 'https://app.brevicor.ca/doctor' })]];
  for (const modality of ['video', 'telephone', null] as const) {
    const details = { clinicName: 'Demo Clinic', start: START, modality, link: LINK };
    out.push([`invitation/${modality}`, visitInvitation(details)]);
    out.push([`cancelled/${modality}`, visitCancelled(details)]);
    out.push([`cancelled-no-link/${modality}`, visitCancelled({ ...details, link: undefined })]);
    out.push([`rescheduled/${modality}`, visitRescheduled(details)]);
  }
  return out;
}

describe('notification templates', () => {
  it('formats appointment times in Toronto time, across DST, with plain spaces', () => {
    expect(formatVisitTime(START)).toBe('Tue, Nov 10 at 3:30 p.m.');
    expect(formatVisitTime('2026-07-01T13:05:00Z')).toBe('Wed, Jul 1 at 9:05 a.m.'); // EDT
    expect(formatVisitTime('2026-11-11T05:00:00Z')).toBe('Wed, Nov 11 at 12:00 a.m.');
    expect(formatVisitTime('2026-11-11T17:00:00Z')).toBe('Wed, Nov 11 at 12:00 p.m.');
  });

  it('render the expected text', () => {
    expect(patientWaiting({ link: 'https://app.brevicor.ca/doctor' }).sms).toBe(
      'Brevicor: a patient is waiting in your virtual waiting room. https://app.brevicor.ca/doctor',
    );
    expect(visitInvitation({ clinicName: 'Demo Clinic', start: START, modality: 'video', link: LINK }).sms).toBe(
      `Demo Clinic: your video visit is on Tue, Nov 10 at 3:30 p.m. Join: ${LINK}`,
    );
    expect(visitInvitation({ clinicName: 'Demo Clinic', start: START, modality: 'telephone', link: LINK }).sms).toBe(
      `Demo Clinic: your phone visit is on Tue, Nov 10 at 3:30 p.m. We'll call you. Details: ${LINK}`,
    );
    expect(visitCancelled({ clinicName: 'Demo Clinic', start: START, modality: 'video' }).sms).toBe(
      'Demo Clinic: your video visit on Tue, Nov 10 at 3:30 p.m. has been cancelled.',
    );
    expect(visitRescheduled({ clinicName: 'Demo Clinic', start: START, modality: 'video', link: LINK }).sms).toBe(
      `Demo Clinic: your video visit has moved to Tue, Nov 10 at 3:30 p.m. Join: ${LINK}`,
    );
  });

  it.each(all())('%s: plain GSM-7 within one 160-character SMS', (_name, message) => {
    expect(message.sms).toMatch(GSM7);
    expect(message.sms).not.toMatch(/[  ’]/);
    expect(message.sms.length).toBeLessThanOrEqual(160);
    expect(message.email.text).toBe(message.sms);
    expect(message.email.subject.length).toBeGreaterThan(0);
  });

  it('keeps the clinic name to one short line, falling back to Brevicor', () => {
    const name = (clinicName: string | null) => visitCancelled({ clinicName, start: START, modality: 'video' }).sms.split(':')[0];
    expect(name(null)).toBe('Brevicor');
    expect(name('  ')).toBe('Brevicor');
    expect(name('Demo\nClinic\t West')).toBe('Demo Clinic West');
    expect(name('x'.repeat(80))).toHaveLength(40);
  });

  it('accept only the declared fields (checked by npm run typecheck)', () => {
    // @ts-expect-error: templates have no field for a patient's name
    visitInvitation({ clinicName: 'Demo Clinic', start: START, modality: 'video', link: LINK, patientName: 'Aurelio' });
    // @ts-expect-error: nor a date of birth
    visitCancelled({ clinicName: 'Demo Clinic', start: START, modality: 'video', birthDate: '1984-03-12' });
    // @ts-expect-error: the physician alert takes only the link
    patientWaiting({ link: LINK, reason: 'Chest pain' });
  });
});
