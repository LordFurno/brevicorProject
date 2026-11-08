import type { Appointment, ContactPoint, Patient } from 'fhir/r4';
import { logWarning } from '@/lib/fhir/log';
import { appointmentModality } from '@/lib/fhir/modality';
import { FhirError } from '@/lib/fhir/outcome';
import { recipientKey, type NotifyConfig } from './config';
import { FhirLookupError, type FhirReader } from './fhir';
import { maskRecipient, normalizePhone } from './phone';
import type { Channels } from './providers';
import { twilioHint } from './providers/twilio-errors';
import { DeliveryError, type ChannelId } from './providers/types';
import type { LogRow, NotifyStore } from './store';
import { patientWaiting, visitCancelled, visitInvitation, visitRescheduled, type RenderedMessage } from './templates';
import type { DeliveryResult, EventResult, NotificationType } from './types';

/**
 * Turns one notification event into deliveries:
 *
 * - patient_waiting: the clinic's physicians linked to the Practitioner, by
 *   their physician_contacts channels. Physicians online right now are skipped.
 * - visit_*: the Appointment's patient, by Patient.telecom (mobile preferred)
 *   read through the FHIR API. Contact details never come from the caller.
 *
 * Each (dedupeKey, channel, recipient) is processed at most once per clinic,
 * and nothing here throws for a failed delivery: failures come back as results.
 */

export interface EventInput {
  type: NotificationType;
  dedupeKey: string;
  practitionerRef?: string;
  patientRef?: string;
  appointmentRef?: string;
  /** Already checked against APP_BASE_URL and normalized (config.allowedLink). */
  link?: string;
}

export interface NotifyDeps {
  store: NotifyStore;
  fhir: FhirReader;
  channels: Channels;
  config: NotifyConfig;
  now?: () => Date;
}

/** Send `message` to `address`, or record why not. */
type Planned =
  | { channel: ChannelId; kind: 'send'; address: string; message: RenderedMessage }
  | { channel: ChannelId; kind: 'skip' | 'fail'; address?: string; code: string };

const PATIENT_CHANNELS: ChannelId[] = ['sms', 'email'];
const HOUR_MS = 3_600_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function processEvent(clinicId: string, input: EventInput, deps: NotifyDeps): Promise<EventResult> {
  const head = { type: input.type, dedupeKey: input.dedupeKey };
  const existing = await deps.store.findByDedupeKey(clinicId, input.dedupeKey);
  if (existing.length > 0) {
    if (existing.some((row) => row.type !== input.type)) {
      throw new FhirError(409, 'conflict', 'This dedupeKey was already used for a different notification type');
    }
    return { ...head, deduplicated: true, results: existing.map(toResult) };
  }

  const planned = input.type === 'patient_waiting' ? await planPhysicianAlert(clinicId, input, deps) : await planPatientMessage(clinicId, input, deps);
  const outcomes = await Promise.all(planned.map((p) => deliver(clinicId, input, p, deps)));
  return { ...head, deduplicated: outcomes.every((o) => o.lostClaim), results: outcomes.map((o) => o.result) };
}

async function planPhysicianAlert(clinicId: string, input: EventInput, deps: NotifyDeps): Promise<Planned[]> {
  let practitionerRefs: string[];
  if (input.practitionerRef) {
    practitionerRefs = [input.practitionerRef];
  } else {
    const appointment = await lookup(() => deps.fhir.read<Appointment>('Appointment', refId(input.appointmentRef!)));
    if (appointment instanceof FhirLookupError) return [fail('sms', appointment)];
    practitionerRefs = participants(appointment, 'Practitioner');
  }

  const byUser = new Map((await Promise.all(practitionerRefs.map((ref) => deps.store.physicianContacts(clinicId, ref)))).flat().map((c) => [c.userId, c]));
  if (byUser.size === 0) return [{ channel: 'sms', kind: 'skip', code: 'no_recipient' }];

  const message = patientWaiting({ link: input.link! });
  const now = (deps.now ?? (() => new Date()))().getTime();
  const windowMs = deps.config.onlineWindowSeconds * 1000;
  return [...byUser.values()].flatMap((contact) =>
    contact.channels.map((channel): Planned => {
      const address = channel === 'sms' ? contact.phone : contact.email;
      if (!address) return { channel, kind: 'skip', code: 'no_recipient' };
      if (contact.lastSeenAt && now - Date.parse(contact.lastSeenAt) < windowMs) return { channel, kind: 'skip', address, code: 'online' };
      return { channel, kind: 'send', address, message };
    }),
  );
}

async function planPatientMessage(clinicId: string, input: EventInput, deps: NotifyDeps): Promise<Planned[]> {
  const appointment = await lookup(() => deps.fhir.read<Appointment>('Appointment', refId(input.appointmentRef!)));
  if (appointment instanceof FhirLookupError) return PATIENT_CHANNELS.map((ch) => fail(ch, appointment));

  const patients = participants(appointment, 'Patient');
  if (input.patientRef && !patients.includes(input.patientRef)) {
    throw new FhirError(400, 'invalid', 'patientRef is not a participant of the appointment');
  }
  if (!input.patientRef && patients.length > 1) throw new FhirError(400, 'invalid', 'The appointment has several patients: send patientRef');
  const patientRef = input.patientRef ?? patients[0];
  if (!patientRef) return PATIENT_CHANNELS.map((channel) => ({ channel, kind: 'skip', code: 'no_patient' }));
  if (!appointment.start || Number.isNaN(Date.parse(appointment.start))) {
    return PATIENT_CHANNELS.map((channel) => ({ channel, kind: 'fail', code: 'appointment_without_start' }));
  }

  const patient = await lookup(() => deps.fhir.read<Patient>('Patient', refId(patientRef)));
  if (patient instanceof FhirLookupError) return PATIENT_CHANNELS.map((ch) => fail(ch, patient));

  // Only these fields reach a template: nothing from the Patient but its contact points.
  const message = renderVisit(input.type, {
    clinicName: await deps.store.clinicDisplayName(clinicId),
    start: appointment.start,
    modality: appointmentModality(appointment),
    link: input.link,
  });
  return [plan('sms', patientPhone(patient.telecom), message), plan('email', patientEmail(patient.telecom), message)];
}

function renderVisit(type: NotificationType, details: Parameters<typeof visitCancelled>[0]): RenderedMessage {
  switch (type) {
    case 'visit_invitation':
      return visitInvitation({ ...details, link: details.link! });
    case 'visit_rescheduled':
      return visitRescheduled({ ...details, link: details.link! });
    case 'visit_cancelled':
      return visitCancelled(details);
    default:
      throw new Error(`not a patient-facing type: ${type}`);
  }
}

/** A contact point that is missing gives no_recipient; one that is present but unusable gives invalid_recipient. */
function plan(channel: ChannelId, address: string | null | undefined, message: RenderedMessage): Planned {
  if (address === undefined) return { channel, kind: 'skip', code: 'no_recipient' };
  if (address === null) return { channel, kind: 'skip', code: 'invalid_recipient' };
  return { channel, kind: 'send', address, message };
}

/** Mobile first, then any other current phone. Undefined = none on file, null = not a usable number. */
export function patientPhone(telecom: ContactPoint[] | undefined): string | null | undefined {
  const phones = (telecom ?? []).filter((t) => t.system === 'phone' && t.value && t.use !== 'old');
  const pick = phones.find((t) => t.use === 'mobile') ?? phones[0];
  return pick ? (normalizePhone(pick.value!) ?? null) : undefined;
}

export function patientEmail(telecom: ContactPoint[] | undefined): string | null | undefined {
  const pick = (telecom ?? []).find((t) => t.system === 'email' && t.value && t.use !== 'old');
  if (!pick) return undefined;
  const email = pick.value!.trim();
  return EMAIL_RE.test(email) ? email : null;
}

interface Outcome {
  result: DeliveryResult;
  /** Another request had already claimed this delivery. */
  lostClaim: boolean;
}

async function deliver(clinicId: string, input: EventInput, p: Planned, deps: NotifyDeps): Promise<Outcome> {
  const { store, config } = deps;
  const channel = deps.channels[p.channel];
  const masked = p.address ? maskRecipient(p.channel, p.address) : null;
  const key = p.address ? recipientKey(config.recipientSecret, p.channel, p.address) : 'none';

  let row: LogRow | null;
  try {
    row = await store.claim({
      clinicId,
      type: input.type,
      channel: p.channel,
      provider: p.kind === 'send' ? channel.provider : null,
      recipientMasked: masked,
      recipientKey: key,
      status: p.kind === 'send' ? 'sending' : p.kind === 'skip' ? 'skipped' : 'failed',
      providerMessageId: null,
      errorCode: p.kind === 'send' ? null : p.code,
      dedupeKey: input.dedupeKey,
    });
  } catch {
    // Without a claim there is no duplicate protection, so nothing is sent.
    return { result: result(p.channel, 'failed', masked, null, 'store_unavailable'), lostClaim: false };
  }
  if (!row) {
    const winner = (await store.findByDedupeKey(clinicId, input.dedupeKey).catch(() => [])).find(
      (r) => r.channel === p.channel && r.recipientKey === key,
    );
    return { result: winner ? toResult(winner) : result(p.channel, 'sending', masked, channel.provider, null), lostClaim: true };
  }
  if (p.kind !== 'send') return { result: toResult(row), lostClaim: false };

  const finish = async (update: Pick<LogRow, 'status' | 'providerMessageId' | 'errorCode'>): Promise<Outcome> => {
    try {
      await store.finish(clinicId, row.id, update);
    } catch {
      // The row stays 'sending': it still blocks a resend and counts toward the rate limit.
      logWarning('notify.store', { clinic: clinicId, issue: 'could not record a delivery outcome', id: row.id });
    }
    return { result: toResult({ ...row, ...update }), lostClaim: false };
  };

  try {
    const since = new Date((deps.now ?? (() => new Date()))().getTime() - HOUR_MS);
    if ((await store.countRecent(clinicId, key, since, row.id)) >= config.maxPerHour) {
      return finish({ status: 'skipped', providerMessageId: null, errorCode: 'rate_limited' });
    }
  } catch {
    return finish({ status: 'failed', providerMessageId: null, errorCode: 'store_unavailable' });
  }

  try {
    const { providerMessageId } = await channel.send({
      to: p.address,
      text: p.channel === 'sms' ? p.message.sms : p.message.email.text,
      ...(p.channel === 'email' ? { subject: p.message.email.subject } : {}),
      templateId: p.message.templateId,
    });
    return finish({ status: 'sent', providerMessageId, errorCode: null });
  } catch (err) {
    return finish({ status: 'failed', providerMessageId: null, errorCode: err instanceof DeliveryError ? err.code : 'provider_error' });
  }
}

const DETAILS: Record<string, string> = {
  no_recipient: 'No contact on file for this channel.',
  invalid_recipient: 'The contact on file for this channel is not a valid phone number or email.',
  online: 'The physician is online; the in-app alert covers them.',
  rate_limited: 'This recipient reached the hourly message limit (NOTIFY_MAX_PER_HOUR).',
  no_patient: 'The appointment has no patient participant.',
  appointment_without_start: 'The appointment has no start time.',
  store_unavailable: 'The notification log was unavailable, so nothing was sent.',
  provider_error: 'The notification provider failed unexpectedly.',
  'config:unknown_provider': 'NOTIFY_SMS_PROVIDER / NOTIFY_EMAIL_PROVIDER names a provider that does not exist.',
};

export function explain(code: string): string {
  if (code.startsWith('twilio:')) return twilioHint(code);
  const fhir = /^fhir:([A-Za-z]+):(\d{3})$/.exec(code);
  if (fhir) return `Reading the ${fhir[1]} through the FHIR API failed (HTTP ${fhir[2]}).`;
  return DETAILS[code] ?? code;
}

function toResult(row: Pick<LogRow, 'channel' | 'status' | 'recipientMasked' | 'provider' | 'providerMessageId' | 'errorCode'>): DeliveryResult {
  return {
    ...result(row.channel, row.status, row.recipientMasked, row.provider, row.errorCode),
    providerMessageId: row.providerMessageId,
  };
}

function result(channel: ChannelId, status: DeliveryResult['status'], recipient: string | null, provider: string | null, errorCode: string | null): DeliveryResult {
  return { channel, status, recipient, provider, providerMessageId: null, errorCode, ...(errorCode ? { detail: explain(errorCode) } : {}) };
}

function fail(channel: ChannelId, err: FhirLookupError): Planned {
  return { channel, kind: 'fail', code: `fhir:${err.resourceType}:${err.status}` };
}

/** Runs a FHIR read; a FhirLookupError is returned (becomes a failed delivery), anything else is rethrown. */
async function lookup<T>(read: () => Promise<T>): Promise<T | FhirLookupError> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof FhirLookupError) return err;
    throw err;
  }
}

/** 'Patient/123' (or an absolute URL, or with /_history) -> 'Patient/123' for every participant of that type. */
function participants(appointment: Appointment, type: 'Patient' | 'Practitioner'): string[] {
  const re = new RegExp(`(?:^|/)${type}/([A-Za-z0-9.-]{1,64})(?:/_history/[^/]+)?$`);
  const refs = (appointment.participant ?? []).flatMap((p) => {
    const m = re.exec(p.actor?.reference ?? '');
    return m ? [`${type}/${m[1]}`] : [];
  });
  return [...new Set(refs)];
}

function refId(ref: string): string {
  return ref.slice(ref.indexOf('/') + 1);
}
