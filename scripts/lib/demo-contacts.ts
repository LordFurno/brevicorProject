import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContactPoint, Patient } from 'fhir/r4';
import { FHIR_RESOURCES_TABLE } from '@/lib/fhir/providers/mock';
import { toRow } from '@/lib/fhir/providers/mock-index';
import { formatLocal } from '@/lib/fhir/providers/adapter/helpers';
import { defaultTimeZone } from '@/lib/fhir/search';
import { normalizePhone } from '@/lib/notify/phone';
import { CLINICSOFT_SCHEMA } from '@/lib/vendors/clinicsoft/rows';
import { fail, upsertRows } from './cli';
import type { PlannedAppointment } from './appointments';

/**
 * Nobody should ever call or email a Synthea-generated contact. The only phone
 * numbers and emails in the demo data are DEMO_PHONE_NUMBERS / DEMO_EMAILS
 * (contacts you control). The first patients with booked appointments today get
 * them in order (patient 1 gets the first phone and the first email, and so on),
 * in demo-mock and ClinicSoft alike; every other patient has none.
 */

export interface DemoContact {
  phone?: string;
  email?: string;
}

const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

export { normalizePhone };

export function parseDemoPhones(value: string | undefined): string[] {
  return splitList(value).map((raw) => {
    const phone = normalizePhone(raw);
    if (!phone) fail('DEMO_PHONE_NUMBERS must be comma-separated phone numbers: E.164 (+16135550123) or 10-digit North American (6135550123)');
    return phone;
  });
}

export function parseDemoEmails(value: string | undefined): string[] {
  const list = splitList(value);
  if (list.some((e) => !EMAIL.test(e))) fail('DEMO_EMAILS must be comma-separated email addresses');
  return list;
}

function splitList(value: string | undefined): string[] {
  return (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** patientId -> contact, for the first distinct patients with booked appointments today (by start time). */
export function pickDemoContacts(
  plan: PlannedAppointment[],
  phones: string[],
  emails: string[],
  now: Date,
  timeZone = defaultTimeZone(),
): Map<string, DemoContact> {
  const localDate = (d: Date) => formatLocal(d.toISOString(), timeZone);
  const today = localDate(now);
  const slots = Math.max(phones.length, emails.length);
  const assigned = new Map<string, DemoContact>();
  const todays = plan
    .filter((p) => p.status === 'booked' && localDate(p.start) === today)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const p of todays) {
    if (assigned.size >= slots) break;
    if (assigned.has(p.patientId)) continue;
    const i = assigned.size;
    assigned.set(p.patientId, { ...(phones[i] ? { phone: phones[i] } : {}), ...(emails[i] ? { email: emails[i] } : {}) });
  }
  return assigned;
}

/** The FHIR telecom for a demo patient: demo contacts first, other (non-phone/email) entries kept. */
export function demoTelecom(existing: ContactPoint[] | undefined, contact: DemoContact | undefined): ContactPoint[] {
  const others = (existing ?? []).filter((t) => t.system !== 'phone' && t.system !== 'email');
  return [
    ...(contact?.phone ? [{ system: 'phone' as const, value: contact.phone, use: 'mobile' as const }] : []),
    ...(contact?.email ? [{ system: 'email' as const, value: contact.email }] : []),
    ...others,
  ];
}

/** Writes the assignment to the FHIR clinic and (if given) the ClinicSoft practice, clearing every other contact. */
export async function applyDemoContacts(
  db: SupabaseClient,
  contacts: Map<string, DemoContact>,
  target: { fhirClinic: string; clinicSoftPractice: string | null; now: Date },
): Promise<void> {
  const { data, error } = await db
    .from(FHIR_RESOURCES_TABLE)
    .select('id, version_id, resource')
    .eq('clinic_id', target.fhirClinic)
    .eq('resource_type', 'Patient');
  if (error) fail(`reading patients failed (${error.code})`);
  const changed = (data ?? []).flatMap((row) => {
    const patient = row.resource as Patient;
    const telecom = demoTelecom(patient.telecom, contacts.get(patient.id!));
    if (JSON.stringify(telecom) === JSON.stringify(patient.telecom ?? [])) return [];
    const { telecom: _old, ...rest } = patient;
    const updated: Patient = telecom.length > 0 ? { ...rest, telecom } : rest;
    return [toRow(target.fhirClinic, updated, (row.version_id as number) + 1, target.now)];
  });
  await upsertRows(db, changed);

  if (target.clinicSoftPractice) {
    const patients = () => db.schema(CLINICSOFT_SCHEMA).from('patients');
    const cleared = await patients().update({ cellPhone: null, homePhone: null, email: null }).eq('practice_id', target.clinicSoftPractice);
    if (cleared.error) fail(`clearing ClinicSoft contacts failed (${cleared.error.code})`);
    for (const [patientNo, contact] of contacts) {
      const { error: e } = await patients()
        .update({ cellPhone: contact.phone ?? null, email: contact.email ?? null })
        .eq('practice_id', target.clinicSoftPractice)
        .eq('patientNo', patientNo);
      if (e) fail(`setting a ClinicSoft demo contact failed (${e.code})`);
    }
  }
}
