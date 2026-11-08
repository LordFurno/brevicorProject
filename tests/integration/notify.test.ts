import { randomBytes, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Appointment, Patient } from 'fhir/r4';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MockProvider } from '@/lib/fhir/providers/mock';
import { gatewayReader, handleNotifyEvent, handlePresence } from '@/lib/notify/api';
import { notifyConfig } from '@/lib/notify/config';
import { normalizePhone } from '@/lib/notify/phone';
import type { NotificationChannel, OutgoingMessage } from '@/lib/notify/providers/types';
import { processEvent, type EventInput } from '@/lib/notify/service';
import { supabaseNotifyStore } from '@/lib/notify/store';
import type { EventResult } from '@/lib/notify/types';
import { handleClinicSoftRequest } from '@/lib/vendors/clinicsoft/api';
import { localDate } from '@/scripts/lib/appointments';
import { ensureUser, setMemberships } from '@/scripts/lib/users';

/**
 * The notification service against real Supabase and the real gateway:
 * patient contacts resolved through the FHIR API for demo-mock and
 * demo-clinicsoft (ClinicSoft called in process), the notification_log unique
 * key, and the HTTP handlers with real tokens. Messages go to fake channels or
 * the console provider: nothing is texted.
 *
 * Needs `npm run fhir:reset -- demo-mock` to have run today, with DEMO_PHONE_NUMBERS set.
 */
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const vendorBase = process.env.CLINICSOFT_BASE_URL;
const vendorKey = process.env.CLINICSOFT_API_KEY;
const demoPhones = (process.env.DEMO_PHONE_NUMBERS ?? '').split(',').map((s) => normalizePhone(s.trim())).filter(Boolean);
const demoEmails = (process.env.DEMO_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const APP = 'https://app.notify.test';

describe.skipIf(!url || !key || !vendorBase || !vendorKey || demoPhones.length === 0)('notifications (Supabase + gateway)', () => {
  const run = randomUUID().slice(0, 8);
  const serviceToken = randomBytes(32).toString('base64url');
  const userEmail = `cf-notify-${run}@test.brevicor.test`;
  const password = randomBytes(18).toString('base64url');
  const practitionerRef = `Practitioner/cf-notify-${run}`;
  let db: SupabaseClient;
  let userId = '';
  let userToken = '';
  /** Today's booked appointment whose patient has a demo phone, and one whose patient has no contact. */
  let withPhone: { appointment: Appointment; patient: Patient };
  let withoutPhone: { appointment: Appointment; patient: Patient };

  beforeAll(async () => {
    vi.stubEnv('INTERNAL_SERVICE_TOKEN', serviceToken);
    vi.stubEnv('APP_BASE_URL', APP);
    db = createClient(url!, key!, { auth: { persistSession: false } });

    // demo-clinicsoft's adapter calls CLINICSOFT_BASE_URL: answer it in process instead of needing npm run dev.
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const target = new URL(input instanceof Request ? input.url : String(input));
      if (target.href.startsWith(vendorBase!)) {
        const path = target.pathname.replace(/^.*\/api\/mock-vendors\/clinicsoft\/v2\//, '').split('/');
        return handleClinicSoftRequest(new Request(target, init), path, { db, apiKey: vendorKey });
      }
      return realFetch(input, init);
    });

    const mock = new MockProvider(db, 'demo-mock');
    const today = localDate(new Date(), 'America/Toronto');
    const bundle = await mock.search('Appointment', { params: [['date', today], ['status', 'booked']], count: 100, offset: 0 });
    const appointments = (bundle.entry ?? []).map((e) => e.resource as Appointment).sort((a, b) => a.start!.localeCompare(b.start!));
    for (const appointment of appointments) {
      const ref = appointment.participant?.find((p) => p.actor?.reference?.startsWith('Patient/'))?.actor?.reference;
      if (!ref) continue;
      const patient = (await mock.read('Patient', ref.slice('Patient/'.length))) as Patient;
      const hasPhone = patient.telecom?.some((t) => t.system === 'phone');
      if (hasPhone) withPhone ??= { appointment, patient };
      else if (!patient.telecom?.some((t) => t.system === 'email')) withoutPhone ??= { appointment, patient };
    }
    if (!withPhone || !withoutPhone) throw new Error('need seeded appointments today with and without demo phones: run `npm run fhir:reset -- demo-mock`');

    // A throwaway physician in demo-mock, linked to a Practitioner nobody else uses.
    userId = await ensureUser(db, userEmail, password);
    await setMemberships(db, userId, [{ clinicId: 'demo-mock', role: 'physician', practitionerRef }]);
    const contact = await db.from('physician_contacts').insert({ user_id: userId, clinic_id: 'demo-mock', phone: '+15005550006' });
    if (contact.error) throw new Error(contact.error.message);
    const signIn = await createClient(url!, key!, { auth: { persistSession: false } }).auth.signInWithPassword({ email: userEmail, password });
    if (!signIn.data.session) throw new Error(`sign-in failed: ${signIn.error?.message}`);
    userToken = signIn.data.session.access_token;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    if (userId) await db.auth.admin.deleteUser(userId); // membership and contact cascade
    await db.from('notification_log').delete().in('clinic_id', ['demo-mock', 'demo-clinicsoft']).like('dedupe_key', `itest-${run}%`);
  });

  function capture() {
    const sent: OutgoingMessage[] = [];
    const channel = (name: 'sms' | 'email'): NotificationChannel => ({
      channel: name,
      provider: 'capture',
      async send(message) {
        sent.push(message);
        return { providerMessageId: `capture-${sent.length}` };
      },
    });
    return { sent, channels: { sms: channel('sms'), email: channel('email') } };
  }

  function notify(clinic: string, input: Omit<EventInput, 'dedupeKey'> & { dedupeKey: string }, channels = capture().channels) {
    return processEvent(clinic, input, {
      store: supabaseNotifyStore(db),
      fhir: gatewayReader(clinic, 'https://gw.test'),
      channels,
      config: notifyConfig(),
    });
  }

  const invitation = (target: { appointment: Appointment }, dedupeKey: string): EventInput => ({
    type: 'visit_invitation',
    dedupeKey,
    appointmentRef: `Appointment/${target.appointment.id}`,
    link: `${APP}/visit/itest`,
  });

  it.each(['demo-mock', 'demo-clinicsoft'])('%s: the patient phone (and email) come from FHIR; no name or DOB in the message', async (clinic) => {
    const { sent, channels } = capture();
    const out = await notify(clinic, invitation(withPhone, `itest-${run}-invite-${clinic}`), channels);
    expect(out.results[0]).toMatchObject({ channel: 'sms', status: 'sent', provider: 'capture' });
    // Booleans, so a failure doesn't print the demo contacts.
    expect(demoPhones.includes(sent.find((m) => m.to.startsWith('+'))?.to)).toBe(true);
    const email = withPhone.patient.telecom?.find((t) => t.system === 'email')?.value;
    if (email) {
      expect(out.results[1]).toMatchObject({ channel: 'email', status: 'sent' });
      expect(demoEmails.includes(sent.find((m) => m.to.includes('@'))?.to.toLowerCase() ?? '')).toBe(true);
    }

    const name = withPhone.patient.name?.[0];
    const identifying = [name?.family, ...(name?.given ?? []), withPhone.patient.birthDate, withPhone.appointment.reasonCode?.[0]?.text].filter(
      (v): v is string => !!v && v.length > 2,
    );
    expect(identifying.length).toBeGreaterThanOrEqual(3);
    for (const message of sent) for (const value of identifying) expect(`${message.subject ?? ''} ${message.text}`).not.toContain(value);
  });

  it('both clinics resolve the same phone for the same appointment', async () => {
    const mock = capture();
    const adapter = capture();
    await notify('demo-mock', invitation(withPhone, `itest-${run}-same`), mock.channels);
    await notify('demo-clinicsoft', invitation(withPhone, `itest-${run}-same`), adapter.channels);
    // Channels send in parallel, so compare as sets. A boolean keeps contacts out of the failure output.
    const recipients = (sent: OutgoingMessage[]) => JSON.stringify(sent.map((m) => m.to).sort());
    expect(mock.sent.length).toBeGreaterThan(0);
    expect(recipients(adapter.sent) === recipients(mock.sent)).toBe(true);
  });

  it.each(['demo-mock', 'demo-clinicsoft'])('%s: a patient with no phone -> skipped', async (clinic) => {
    const { sent, channels } = capture();
    const out = await notify(clinic, invitation(withoutPhone, `itest-${run}-nophone-${clinic}`), channels);
    expect(out.results.map((r) => [r.channel, r.status, r.errorCode])).toEqual([
      ['sms', 'skipped', 'no_recipient'],
      ['email', 'skipped', 'no_recipient'],
    ]);
    expect(sent).toHaveLength(0);
  });

  it('the database unique key: repeats and concurrent requests send once', async () => {
    const { sent, channels } = capture();
    const dedupeKey = `itest-${run}-dedupe`;
    await Promise.all([1, 2, 3].map(() => notify('demo-mock', invitation(withPhone, dedupeKey), channels)));
    const again = await notify('demo-mock', invitation(withPhone, dedupeKey), channels);
    expect(again.deduplicated).toBe(true);
    // Each channel is claimed separately (one request may win the SMS, another the email), but each goes out once.
    expect(sent.filter((m) => m.to.startsWith('+'))).toHaveLength(1);
    expect(sent.filter((m) => m.to.includes('@'))).toHaveLength(withPhone.patient.telecom?.some((t) => t.system === 'email') ? 1 : 0);
    expect(again.results.map((r) => [r.channel, r.status])).toEqual([
      ['sms', 'sent'],
      ['email', withPhone.patient.telecom?.some((t) => t.system === 'email') ? 'sent' : 'skipped'],
    ]);
  });

  it('notification_log holds masked recipients and keys only', async () => {
    const { data, error } = await db.from('notification_log').select('*').eq('clinic_id', 'demo-mock').like('dedupe_key', `itest-${run}%`);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    const stored = JSON.stringify(data);
    for (const phone of demoPhones) expect(stored).not.toContain(phone!.slice(2, 8));
    for (const email of demoEmails) expect(stored.toLowerCase()).not.toContain(email);
  });

  describe('HTTP handlers', () => {
    async function post(path: 'events' | 'presence', token: string | null, body?: unknown) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Clinic-Id': 'demo-mock' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const req = new Request(`https://gw.test/api/notify/v1/${path}`, { method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const res = await (path === 'events' ? handleNotifyEvent : handlePresence)(req);
      const json = await res.json();
      if (res.status >= 400) expect(json.resourceType).toBe('OperationOutcome');
      return { status: res.status, body: json };
    }
    const waiting = (dedupeKey: string) => ({ type: 'patient_waiting', dedupeKey, practitionerRef, link: `${APP}/doctor` });

    it('events: service token only; links must be under APP_BASE_URL', async () => {
      expect((await post('events', null, waiting(`itest-${run}-x`))).status).toBe(401);
      expect((await post('events', userToken, waiting(`itest-${run}-x`))).status).toBe(403);
      expect((await post('events', serviceToken, { ...waiting(`itest-${run}-x`), link: 'https://evil.test/doctor' })).status).toBe(400);
      const res = await fetchPlain(`https://gw.test/api/notify/v1/events`, 'GET');
      expect(res.status).toBe(405);
    });

    it('patient_waiting texts an offline physician, and skips them once they are online', async () => {
      const offline = await post('events', serviceToken, waiting(`itest-${run}-waiting-1`));
      expect(offline.status).toBe(200);
      expect((offline.body as EventResult).results).toEqual([
        expect.objectContaining({ channel: 'sms', status: 'sent', provider: 'console', recipient: '+1******0006' }),
      ]);
      const repeat = await post('events', serviceToken, waiting(`itest-${run}-waiting-1`));
      expect((repeat.body as EventResult).deduplicated).toBe(true);

      expect((await post('presence', serviceToken)).status).toBe(403);
      const presence = await post('presence', userToken);
      expect(presence).toMatchObject({ status: 200, body: { onlineWindowSeconds: 60 } });
      const online = await post('events', serviceToken, waiting(`itest-${run}-waiting-2`));
      expect((online.body as EventResult).results).toEqual([expect.objectContaining({ status: 'skipped', errorCode: 'online' })]);
    });

    async function fetchPlain(target: string, method: string) {
      return handleNotifyEvent(new Request(target, { method, headers: { Authorization: `Bearer ${serviceToken}`, 'X-Clinic-Id': 'demo-mock' } }));
    }
  });
});
