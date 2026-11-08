import type { Modality } from '@/lib/fhir/modality';
import type { NotificationType } from './types';

/**
 * Every message the notification service can send. PHI-free by construction:
 * templates accept only the fields declared below (clinic display name,
 * appointment time, modality, link). Never names, visit reasons, dates of
 * birth or contact details.
 *
 * SMS text is plain GSM-7 (no curly quotes or special spaces, which would
 * switch Twilio to 70-character segments) and fits 160 characters with normal
 * links. (A Twilio trial account can't send custom text at all: see
 * TWILIO_TRIAL_TEMPLATES in providers/twilio-sms.ts.)
 */

export const NOTIFY_TIME_ZONE = 'America/Toronto';

export interface PhysicianAlert {
  link: string;
}

export interface VisitDetails {
  /** The clinic's display name (ehr_connections.display_name). */
  clinicName: string | null;
  /** Appointment start, an ISO instant. */
  start: string;
  modality: Modality | null;
  link?: string;
}

export interface RenderedMessage {
  templateId: NotificationType;
  sms: string;
  email: { subject: string; text: string };
}

export function patientWaiting({ link }: PhysicianAlert): RenderedMessage {
  const text = `Brevicor: a patient is waiting in your virtual waiting room. ${link}`;
  return { templateId: 'patient_waiting', sms: text, email: { subject: 'A patient is waiting', text } };
}

export function visitInvitation(details: VisitDetails & { link: string }): RenderedMessage {
  const v = visit(details);
  const callNote = details.modality === 'telephone' ? " We'll call you." : '';
  // v.when ends in "a.m." / "p.m.", which also ends the sentence.
  const text = `${v.clinic}: your ${v.kind} visit is on ${v.when}${callNote} ${v.action}: ${details.link}`;
  return { templateId: 'visit_invitation', sms: text, email: { subject: `Your ${v.kind} visit with ${v.clinic}`, text } };
}

export function visitCancelled(details: VisitDetails): RenderedMessage {
  const v = visit(details);
  const more = details.link ? ` Details: ${details.link}` : '';
  const text = `${v.clinic}: your ${v.kind} visit on ${v.when} has been cancelled.${more}`;
  return { templateId: 'visit_cancelled', sms: text, email: { subject: `Visit cancelled: ${v.clinic}`, text } };
}

export function visitRescheduled(details: VisitDetails & { link: string }): RenderedMessage {
  const v = visit(details);
  const text = `${v.clinic}: your ${v.kind} visit has moved to ${v.when} ${v.action}: ${details.link}`;
  return { templateId: 'visit_rescheduled', sms: text, email: { subject: `Visit rescheduled: ${v.clinic}`, text } };
}

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: NOTIFY_TIME_ZONE,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** "Tue, Nov 10 at 3:30 p.m." in clinic time, built from parts so no special spaces sneak in. */
export function formatVisitTime(instant: string): string {
  const p = Object.fromEntries(PARTS.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return `${p.weekday}, ${p.month} ${p.day} at ${p.hour}:${p.minute} ${p.dayPeriod === 'AM' ? 'a.m.' : 'p.m.'}`;
}

function visit(details: VisitDetails) {
  return {
    clinic: clinicLabel(details.clinicName),
    when: formatVisitTime(details.start),
    kind: details.modality === 'video' ? 'video' : details.modality === 'telephone' ? 'phone' : 'virtual',
    action: details.modality === 'video' || details.modality === null ? 'Join' : 'Details',
  };
}

/** Admin-entered, but still kept to one short line. Falls back to "Brevicor". */
function clinicLabel(name: string | null): string {
  const label = (name ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  return label || 'Brevicor';
}
