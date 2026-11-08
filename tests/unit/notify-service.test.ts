import type { Appointment, FhirResource, Patient } from 'fhir/r4';
import { describe, expect, it } from 'vitest';
import { MODALITY_SYSTEM } from '@/lib/fhir/modality';
import { FhirError } from '@/lib/fhir/outcome';
import { allowedLink, type NotifyConfig } from '@/lib/notify/config';
import { FhirLookupError, type FhirReader } from '@/lib/notify/fhir';
import type { Channels } from '@/lib/notify/providers';
import { DeliveryError, type ChannelId, type NotificationChannel, type OutgoingMessage } from '@/lib/notify/providers/types';
import { parseEvent } from '@/lib/notify/request';
import { patientPhone, processEvent, type EventInput, type NotifyDeps } from '@/lib/notify/service';
import type { LogRow, NewLogRow, NotifyStore, PhysicianContact } from '@/lib/notify/store';

const APP = 'https://app.brevicor.test';
const LINK = `${APP}/visit/${'t'.repeat(32)}`;
const NOW = new Date('2026-11-10T20:00:00Z');
const MOBILE = '+16135550199';
const EMAIL = 'aurelio.h@example.com';

const PATIENT: Patient = {
  resourceType: 'Patient',
  id: 'pat-1',
  name: [{ family: 'Hettinger', given: ['Aurelio', 'Marco'] }],
  birthDate: '1984-03-12',
  telecom: [
    { system: 'phone', value: '+16135550111', use: 'home' },
    { system: 'phone', value: MOBILE, use: 'mobile' },
    { system: 'email', value: EMAIL },
  ],
  address: [{ line: ['12 Elm St'], city: 'Ottawa' }],
};

function appointment(over: Partial<Appointment> = {}): Appointment {
  return {
    resourceType: 'Appointment',
    id: 'appt-1',
    status: 'booked',
    start: '2026-11-10T20:30:00Z',
    end: '2026-11-10T20:45:00Z',
    serviceType: [{ coding: [{ system: MODALITY_SYSTEM, code: 'video' }] }],
    reasonCode: [{ text: 'Chest pain follow-up' }],
    description: 'Hettinger, Aurelio - chest pain',
    participant: [
      { actor: { reference: 'Patient/pat-1', display: 'Aurelio Hettinger' }, status: 'accepted' },
      { actor: { reference: 'Practitioner/prac-1' }, status: 'accepted' },
    ],
    ...over,
  };
}

// Everything identifying about the patient, in the forms it might leak.
const PHI = ['Hettinger', 'Aurelio', 'Marco', '1984', '03-12', 'Mar 12', 'Elm', 'Ottawa', 'Chest', 'chest', MOBILE, '5550199', '5550111', EMAIL, 'aurelio.h'];

class MemoryStore implements NotifyStore {
  rows: LogRow[] = [];
  contacts = new Map<string, PhysicianContact[]>();
  displayName: string | null = 'Demo Clinic';
  failClaims = false;
  private seq = 0;
  constructor(private readonly now: () => Date) {}

  async findByDedupeKey(clinicId: string, dedupeKey: string) {
    return this.rows.filter((r) => r.clinicId === clinicId && r.dedupeKey === dedupeKey).map((r) => ({ ...r }));
  }
  async claim(row: NewLogRow) {
    if (this.failClaims) throw new Error('db down');
    // The same unique key as notification_log.
    const taken = this.rows.some(
      (r) => r.clinicId === row.clinicId && r.dedupeKey === row.dedupeKey && r.channel === row.channel && r.recipientKey === row.recipientKey,
    );
    if (taken) return null;
    const saved: LogRow = { ...row, id: `row-${++this.seq}`, createdAt: this.now().toISOString() };
    this.rows.push(saved);
    return { ...saved };
  }
  async finish(_clinicId: string, id: string, update: Pick<LogRow, 'status' | 'providerMessageId' | 'errorCode'>) {
    Object.assign(this.rows.find((r) => r.id === id)!, update);
  }
  async countRecent(clinicId: string, recipientKey: string, since: Date, excludeId: string) {
    return this.rows.filter(
      (r) =>
        r.clinicId === clinicId &&
        r.recipientKey === recipientKey &&
        (r.status === 'sending' || r.status === 'sent') &&
        Date.parse(r.createdAt) >= since.getTime() &&
        r.id !== excludeId,
    ).length;
  }
  async physicianContacts(_clinicId: string, practitionerRef: string) {
    return this.contacts.get(practitionerRef) ?? [];
  }
  async touchPresence() {}
  async clinicDisplayName() {
    return this.displayName;
  }
}

function fakeFhir(resources: FhirResource[]): FhirReader {
  return {
    async read<T extends FhirResource>(type: T['resourceType'], id: string): Promise<T> {
      const found = resources.find((r) => r.resourceType === type && r.id === id);
      if (!found) throw new FhirLookupError(type, 404);
      return structuredClone(found) as T;
    },
  };
}

type FakeChannel = NotificationChannel & { sent: OutgoingMessage[] };

function fakeChannel(channel: ChannelId, send?: (m: OutgoingMessage) => Promise<{ providerMessageId: string }>): FakeChannel {
  const sent: OutgoingMessage[] = [];
  return {
    channel,
    provider: 'fake',
    sent,
    async send(message) {
      sent.push(message);
      return send ? send(message) : { providerMessageId: `${channel}-${sent.length}` };
    },
  };
}

function setup(opts: { resources?: FhirResource[]; config?: Partial<NotifyConfig>; sms?: FakeChannel; email?: FakeChannel } = {}) {
  let now = NOW;
  const store = new MemoryStore(() => now);
  const sms = opts.sms ?? fakeChannel('sms');
  const email = opts.email ?? fakeChannel('email');
  const deps: NotifyDeps = {
    store,
    fhir: fakeFhir(opts.resources ?? [PATIENT, appointment()]),
    channels: { sms, email } satisfies Channels,
    config: { appBaseUrl: APP, onlineWindowSeconds: 60, maxPerHour: 20, recipientSecret: Buffer.from('test-secret'), ...opts.config },
    now: () => now,
  };
  return {
    store,
    sms,
    email,
    deps,
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
    run: (input: Partial<EventInput> & Pick<EventInput, 'type'>, clinic = 'clinic-a') =>
      processEvent(clinic, { dedupeKey: `k-${input.type}`, appointmentRef: 'Appointment/appt-1', link: LINK, ...input }, deps),
  };
}

const physician = (over: Partial<PhysicianContact> = {}): PhysicianContact => ({
  userId: 'user-1',
  phone: '+16135550177',
  email: null,
  channels: ['sms'],
  lastSeenAt: null,
  ...over,
});

describe('patient-facing notifications', () => {
  it('texts the mobile number and emails the address from FHIR, with no PHI in either', async () => {
    const t = setup();
    const out = await t.run({ type: 'visit_invitation' });
    expect(out.deduplicated).toBe(false);
    expect(out.results).toEqual([
      expect.objectContaining({ channel: 'sms', status: 'sent', recipient: '+1******0199', provider: 'fake', providerMessageId: 'sms-1', errorCode: null }),
      expect.objectContaining({ channel: 'email', status: 'sent', recipient: 'a***@e***.com', providerMessageId: 'email-1' }),
    ]);
    expect(t.sms.sent[0]).toMatchObject({ to: MOBILE, templateId: 'visit_invitation' });
    expect(t.sms.sent[0].text).toBe(`Demo Clinic: your video visit is on Tue, Nov 10 at 3:30 p.m. Join: ${LINK}`);
    expect(t.email.sent[0]).toMatchObject({ to: EMAIL, subject: 'Your video visit with Demo Clinic' });
  });

  it.each(['visit_invitation', 'visit_cancelled', 'visit_rescheduled'] as const)('%s never contains the name, DOB, reason or contacts', async (type) => {
    for (const code of ['video', 'telephone']) {
      const t = setup({ resources: [PATIENT, appointment({ serviceType: [{ coding: [{ system: MODALITY_SYSTEM, code }] }] })] });
      await t.run({ type });
      const bodies = [...t.sms.sent, ...t.email.sent].flatMap((m) => [m.text, m.subject ?? '']);
      expect(bodies.length).toBe(4);
      for (const body of bodies) for (const phi of PHI) expect(body).not.toContain(phi);
    }
  });

  it('the log never holds a full number or address', async () => {
    const t = setup();
    await t.run({ type: 'visit_invitation' });
    const stored = JSON.stringify(t.store.rows);
    for (const value of [MOBILE, '5550199', EMAIL, 'aurelio.h']) expect(stored).not.toContain(value);
    expect(t.store.rows.map((r) => r.recipientKey)).toEqual([expect.stringMatching(/^[0-9a-f]{32}$/), expect.stringMatching(/^[0-9a-f]{32}$/)]);
  });

  it('no phone on the patient -> sms skipped, not an error', async () => {
    const t = setup({ resources: [{ ...PATIENT, telecom: [{ system: 'email', value: EMAIL }] }, appointment()] });
    const out = await t.run({ type: 'visit_invitation' });
    expect(out.results[0]).toMatchObject({ channel: 'sms', status: 'skipped', errorCode: 'no_recipient', recipient: null });
    expect(out.results[1]).toMatchObject({ channel: 'email', status: 'sent' });
    expect(t.sms.sent).toHaveLength(0);
  });

  it('a phone that is not a usable number -> invalid_recipient', async () => {
    const t = setup({ resources: [{ ...PATIENT, telecom: [{ system: 'phone', value: '555-0100', use: 'mobile' }] }, appointment()] });
    const out = await t.run({ type: 'visit_invitation' });
    expect(out.results.map((r) => [r.channel, r.status, r.errorCode])).toEqual([
      ['sms', 'skipped', 'invalid_recipient'],
      ['email', 'skipped', 'no_recipient'],
    ]);
  });

  it('prefers use=mobile, then any current phone, never use=old', () => {
    expect(patientPhone(PATIENT.telecom)).toBe(MOBILE);
    expect(patientPhone([{ system: 'phone', value: '6135550111', use: 'home' }])).toBe('+16135550111');
    expect(patientPhone([{ system: 'phone', value: '+16135550111', use: 'old' }])).toBeUndefined();
    expect(patientPhone(undefined)).toBeUndefined();
  });

  it('the patient comes from the appointment; a patientRef that is not on it -> 400', async () => {
    const t = setup();
    const err = await t.run({ type: 'visit_invitation', patientRef: 'Patient/someone-else' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FhirError);
    expect((err as FhirError).status).toBe(400);
    expect(t.sms.sent).toHaveLength(0);
    expect((await t.run({ type: 'visit_invitation', patientRef: 'Patient/pat-1' })).results[0].status).toBe('sent');
  });

  it('a FHIR read that fails is a failed delivery, not a thrown error', async () => {
    const t = setup({ resources: [PATIENT] });
    const out = await t.run({ type: 'visit_invitation', appointmentRef: 'Appointment/missing' });
    expect(out.results.map((r) => [r.channel, r.status, r.errorCode])).toEqual([
      ['sms', 'failed', 'fhir:Appointment:404'],
      ['email', 'failed', 'fhir:Appointment:404'],
    ]);
    expect(out.results[0].detail).toBe('Reading the Appointment through the FHIR API failed (HTTP 404).');
  });
});

describe('patient_waiting', () => {
  it('texts the physician linked to the Practitioner', async () => {
    const t = setup();
    t.store.contacts.set('Practitioner/prac-1', [physician()]);
    const out = await t.run({ type: 'patient_waiting', practitionerRef: 'Practitioner/prac-1', link: `${APP}/doctor` });
    expect(out.results).toEqual([expect.objectContaining({ channel: 'sms', status: 'sent', recipient: '+1******0177' })]);
    expect(t.sms.sent[0]).toMatchObject({ to: '+16135550177', text: `Brevicor: a patient is waiting in your virtual waiting room. ${APP}/doctor` });
  });

  it("finds the physician from the appointment when there is no practitionerRef", async () => {
    const t = setup();
    t.store.contacts.set('Practitioner/prac-1', [physician()]);
    const out = await t.run({ type: 'patient_waiting' });
    expect(out.results[0].status).toBe('sent');
  });

  it('an online physician (seen within the window) is skipped; an offline one is texted', async () => {
    const t = setup();
    t.store.contacts.set('Practitioner/prac-1', [physician({ lastSeenAt: new Date(NOW.getTime() - 30_000).toISOString() })]);
    const online = await t.run({ type: 'patient_waiting', practitionerRef: 'Practitioner/prac-1', dedupeKey: 'patient_waiting:v1' });
    expect(online.results[0]).toMatchObject({ status: 'skipped', errorCode: 'online', recipient: '+1******0177' });
    expect(t.sms.sent).toHaveLength(0);

    t.store.contacts.set('Practitioner/prac-1', [physician({ lastSeenAt: new Date(NOW.getTime() - 90_000).toISOString() })]);
    const offline = await t.run({ type: 'patient_waiting', practitionerRef: 'Practitioner/prac-1', dedupeKey: 'patient_waiting:v2' });
    expect(offline.results[0].status).toBe('sent');
  });

  it('every physician sharing the Practitioner gets one, but one phone gets one text', async () => {
    const t = setup();
    t.store.contacts.set('Practitioner/prac-1', [
      physician({ userId: 'u1', phone: '+16135550101' }),
      physician({ userId: 'u2', phone: '+16135550102' }),
      physician({ userId: 'u3', phone: '+16135550101' }),
    ]);
    const out = await t.run({ type: 'patient_waiting', practitionerRef: 'Practitioner/prac-1' });
    expect(t.sms.sent.map((m) => m.to).sort()).toEqual(['+16135550101', '+16135550102']);
    expect(out.results).toHaveLength(3);
  });

  it('no physician contact -> skipped', async () => {
    const t = setup();
    const out = await t.run({ type: 'patient_waiting', practitionerRef: 'Practitioner/nobody' });
    expect(out.results).toEqual([expect.objectContaining({ channel: 'sms', status: 'skipped', errorCode: 'no_recipient' })]);
  });
});

describe('dedupe', () => {
  it('the same key never sends twice: a repeat returns the existing entries', async () => {
    const t = setup();
    const first = await t.run({ type: 'visit_invitation' });
    for (let i = 0; i < 5; i++) {
      const again = await t.run({ type: 'visit_invitation' });
      expect(again.deduplicated).toBe(true);
      expect(again.results).toEqual(first.results);
    }
    expect(t.sms.sent).toHaveLength(1);
    expect(t.email.sent).toHaveLength(1);
  });

  it('concurrent requests with one key (heartbeats) send once', async () => {
    const t = setup();
    t.store.contacts.set('Practitioner/prac-1', [physician()]);
    const runs = await Promise.all(
      Array.from({ length: 4 }, () => t.run({ type: 'patient_waiting', practitionerRef: 'Practitioner/prac-1', dedupeKey: 'patient_waiting:v_abc' })),
    );
    expect(t.sms.sent).toHaveLength(1);
    expect(runs.filter((r) => !r.deduplicated)).toHaveLength(1);
  });

  it('keys are per clinic', async () => {
    const t = setup();
    await t.run({ type: 'visit_invitation' }, 'clinic-a');
    expect((await t.run({ type: 'visit_invitation' }, 'clinic-b')).deduplicated).toBe(false);
    expect(t.sms.sent).toHaveLength(2);
  });

  it('a key reused for a different type -> 409', async () => {
    const t = setup();
    await t.run({ type: 'visit_invitation', dedupeKey: 'same' });
    const err = (await t.run({ type: 'visit_cancelled', dedupeKey: 'same' }).catch((e: unknown) => e)) as FhirError;
    expect(err.status).toBe(409);
  });

  it('skips and failures use up the key too (no retry loop from the heartbeat)', async () => {
    const t = setup({ sms: fakeChannel('sms', async () => Promise.reject(new DeliveryError('twilio:21608', 'unverified'))) });
    await t.run({ type: 'visit_invitation' });
    await t.run({ type: 'visit_invitation' });
    expect(t.sms.sent).toHaveLength(1);
  });
});

describe('rate limit', () => {
  it(`stops at maxPerHour per recipient, and frees up after an hour`, async () => {
    const t = setup({ config: { maxPerHour: 2 } });
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await t.run({ type: 'visit_invitation', dedupeKey: `k${i}` })).results[0]);
    expect(statuses.map((r) => r.status)).toEqual(['sent', 'sent', 'skipped']);
    expect(statuses[2]).toMatchObject({ errorCode: 'rate_limited', detail: expect.stringContaining('NOTIFY_MAX_PER_HOUR') });
    expect(t.sms.sent).toHaveLength(2);

    t.advance(61 * 60_000);
    expect((await t.run({ type: 'visit_invitation', dedupeKey: 'k-later' })).results[0].status).toBe('sent');
  });
});

describe('failure isolation', () => {
  it('a provider error fails that delivery only; the event still resolves', async () => {
    const t = setup({ sms: fakeChannel('sms', async () => Promise.reject(new DeliveryError('twilio:21608', 'Twilio trial: verify the number.'))) });
    const out = await t.run({ type: 'visit_invitation' });
    expect(out.results[0]).toMatchObject({ channel: 'sms', status: 'failed', errorCode: 'twilio:21608', providerMessageId: null });
    expect(out.results[0].detail).toContain('trial account can only text verified numbers');
    expect(out.results[1]).toMatchObject({ channel: 'email', status: 'sent' });
    expect(t.store.rows.find((r) => r.channel === 'sms')).toMatchObject({ status: 'failed', errorCode: 'twilio:21608' });
  });

  it('an unexpected provider crash is recorded without its message', async () => {
    const t = setup({ sms: fakeChannel('sms', async () => Promise.reject(new Error(`socket closed while texting ${MOBILE}`))) });
    const out = await t.run({ type: 'visit_invitation' });
    expect(out.results[0]).toMatchObject({ status: 'failed', errorCode: 'provider_error' });
    expect(JSON.stringify(out)).not.toContain('5550199');
  });

  it('when the log is unavailable nothing is sent (no duplicate protection)', async () => {
    const t = setup();
    t.store.failClaims = true;
    const out = await t.run({ type: 'visit_invitation' });
    expect(out.results.map((r) => [r.status, r.errorCode])).toEqual([
      ['failed', 'store_unavailable'],
      ['failed', 'store_unavailable'],
    ]);
    expect(t.sms.sent).toHaveLength(0);
  });
});

describe('request validation', () => {
  const parse = (body: unknown) => parseEvent(body, APP);
  const status = (body: unknown) => {
    try {
      parse(body);
      return 200;
    } catch (err) {
      return (err as FhirError).status;
    }
  };
  const base = { type: 'visit_invitation', dedupeKey: 'visit_invitation:v_1', appointmentRef: 'Appointment/a1', link: LINK };

  it('accepts a valid event and normalizes the link', () => {
    expect(parse(base)).toEqual(base);
    expect(parse({ ...base, link: `${APP}/visit/../visit/x` }).link).toBe(`${APP}/visit/x`);
  });

  it.each<[string, unknown]>([
    ['not an object', []],
    ['unknown type', { ...base, type: 'marketing' }],
    ['contact details in the body', { ...base, phone: '+16135550199' }],
    ['a dedupeKey with spaces', { ...base, dedupeKey: 'has spaces' }],
    ['a dedupeKey over 128 chars', { ...base, dedupeKey: 'k'.repeat(129) }],
    ['a malformed reference', { ...base, appointmentRef: 'Patient/a1' }],
    ['a missing link', { ...base, link: undefined }],
    ['an invitation without an appointment', { ...base, appointmentRef: undefined }],
    ['patient_waiting without practitioner or appointment', { type: 'patient_waiting', dedupeKey: 'k', link: LINK }],
  ])('%s -> 400', (_name, body) => {
    expect(status(body)).toBe(400);
  });

  it('visit_cancelled may omit the link', () => {
    expect(status({ ...base, type: 'visit_cancelled', link: undefined })).toBe(200);
  });

  it.each<[string, string]>([
    ['a look-alike host', 'https://app.brevicor.test.evil.com/visit/x'],
    ['credentials in the URL', 'https://user:pw@app.brevicor.test/visit/x'],
    ['another scheme', 'http://app.brevicor.test/visit/x'],
    ['another port', 'https://app.brevicor.test:8443/visit/x'],
    ['another host', 'https://evil.com/?u=https://app.brevicor.test'],
    ['a relative link', '/visit/x'],
    ['javascript:', 'javascript:alert(1)'],
    ['whitespace', `${APP}/visit/x y`],
    ['an over-long link', `${APP}/${'x'.repeat(600)}`],
  ])('link with %s -> rejected', (_name, link) => {
    expect(allowedLink(link, APP)).toBeNull();
    expect(status({ ...base, link })).toBe(400);
  });

  it('a base URL with a path only allows links under that path', () => {
    expect(allowedLink('https://h.test/app/visit/x', 'https://h.test/app')).toBe('https://h.test/app/visit/x');
    expect(allowedLink('https://h.test/app', 'https://h.test/app')).toBe('https://h.test/app');
    expect(allowedLink('https://h.test/application', 'https://h.test/app')).toBeNull();
    expect(allowedLink('https://h.test/other', 'https://h.test/app/')).toBeNull();
  });
});
