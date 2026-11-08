// Usage: npm run notify:test -- <type> [--clinic demo-mock] [--dedupe-key <key>] [--api http://localhost:3000]
// Fires one real notification event through the running app (npm run dev),
// end to end: service token -> /api/notify/v1/events -> FHIR -> provider.
//   patient_waiting: a physician in the clinic with a contact (DEMO_PHYSICIAN_PHONE)
//   visit_*:         the first patient with a phone and a booked appointment today (DEMO_PHONE_NUMBERS)
// Prints each delivery's status (recipients masked). Re-run with the printed
// --dedupe-key to check that nothing is sent twice.
import { randomBytes } from 'node:crypto';
import type { Appointment, Bundle, OperationOutcome, Patient } from 'fhir/r4';
import type { EventResult, NotificationType } from '@/lib/notify/types';
import { NOTIFICATION_TYPES } from '@/lib/notify/types';
import { localDate } from './lib/appointments';
import { adminClient, fail, main } from './lib/cli';

const USAGE = `usage: npm run notify:test -- <${NOTIFICATION_TYPES.join('|')}> [--clinic demo-mock] [--dedupe-key <key>] [--api http://localhost:3000]`;

await main(async () => {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  const appBase = process.env.APP_BASE_URL?.replace(/\/+$/, '');
  if (!token) fail('INTERNAL_SERVICE_TOKEN must be set (see .env.local)');
  if (!appBase) fail('APP_BASE_URL must be set (see .env.local)');
  const headers = { Authorization: `Bearer ${token}`, 'X-Clinic-Id': args.clinic };

  const call = async (path: string, init?: RequestInit): Promise<Response> => {
    try {
      return await fetch(`${args.api}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
    } catch {
      fail(`cannot reach ${args.api}: is npm run dev running?`);
    }
  };
  const fhir = async <T>(path: string): Promise<T> => {
    const res = await call(`/api/fhir/R4/${path}`);
    if (!res.ok) fail(`FHIR ${path.split(/[?/]/)[0]} returned ${res.status}`);
    return (await res.json()) as T;
  };

  const body: Record<string, string> = { type: args.type, dedupeKey: args.dedupeKey };
  if (args.type === 'patient_waiting') {
    body.practitionerRef = await physicianWithContact(args.clinic);
    body.link = `${appBase}/doctor`;
    console.log(`physician: ${body.practitionerRef}`);
  } else {
    Object.assign(body, await patientWithPhoneToday(fhir));
    // A placeholder token: frontend visits are not linked to FHIR appointments yet.
    if (args.type !== 'visit_cancelled') body.link = `${appBase}/visit/notify-test-${randomBytes(12).toString('base64url')}`;
    console.log(`appointment: ${body.appointmentRef}  patient: ${body.patientRef}`);
  }

  const res = await call('/api/notify/v1/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const out = (await res.json()) as EventResult | OperationOutcome;
  if (!res.ok || !('results' in out)) {
    const issues = 'issue' in out ? out.issue.map((i) => i.diagnostics).join('; ') : '';
    fail(`events returned ${res.status}${issues ? `: ${issues}` : ''}`);
  }

  console.log(`${out.type} @ ${args.clinic}  dedupeKey=${out.dedupeKey}${out.deduplicated ? '  (already processed: nothing sent)' : ''}`);
  for (const r of out.results) {
    const outcome = r.providerMessageId ?? r.errorCode ?? '';
    console.log(`  ${r.channel.padEnd(6)}${r.status.padEnd(9)}${(r.recipient ?? '-').padEnd(18)}${(r.provider ?? '-').padEnd(14)}${outcome}`);
    if (r.detail) console.log(`        ${r.detail}`);
  }
  console.log(`re-run with the same key: npm run notify:test -- ${out.type} --clinic ${args.clinic} --dedupe-key ${out.dedupeKey}`);
});

function parseArgs(argv: string[]) {
  const [type, ...rest] = argv;
  if (!type || !(NOTIFICATION_TYPES as readonly string[]).includes(type)) fail(USAGE);
  const opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const [flag, value] = [rest[i], rest[i + 1]];
    if (!['--clinic', '--dedupe-key', '--api'].includes(flag) || !value) fail(USAGE);
    opts[flag.slice(2)] = value;
  }
  return {
    type: type as NotificationType,
    clinic: opts.clinic ?? 'demo-mock',
    dedupeKey: opts['dedupe-key'] ?? `notify-test:${type}:${randomBytes(4).toString('hex')}`,
    api: (opts.api ?? 'http://localhost:3000').replace(/\/+$/, ''),
  };
}

/** A Practitioner whose physician has an SMS contact in this clinic (npm run notify:contacts). */
async function physicianWithContact(clinic: string): Promise<string> {
  const db = adminClient();
  const contacts = await db.from('physician_contacts').select('user_id').eq('clinic_id', clinic).not('phone', 'is', null);
  if (contacts.error) fail(`reading physician_contacts failed (${contacts.error.code})`);
  const userIds = (contacts.data ?? []).map((c) => c.user_id as string);
  if (userIds.length === 0) fail(`no physician in '${clinic}' has a phone: run npm run notify:contacts`);
  const members = await db
    .from('clinic_members')
    .select('practitioner_ref')
    .eq('clinic_id', clinic)
    .eq('role', 'physician')
    .in('user_id', userIds)
    .order('practitioner_ref');
  if (members.error) fail(`reading clinic_members failed (${members.error.code})`);
  const ref = members.data?.[0]?.practitioner_ref as string | undefined;
  if (!ref) fail(`no physician with a contact in '${clinic}' is linked to a Practitioner`);
  return ref;
}

/** The first booked appointment today (by start) whose patient has a phone, read through the FHIR API. */
async function patientWithPhoneToday(fhir: <T>(path: string) => Promise<T>): Promise<{ appointmentRef: string; patientRef: string }> {
  const today = localDate(new Date(), 'America/Toronto');
  const bundle = await fhir<Bundle<Appointment>>(`Appointment?date=${today}&status=booked&_count=100`);
  const appointments = (bundle.entry ?? [])
    .map((e) => e.resource)
    .filter((a): a is Appointment => a?.resourceType === 'Appointment')
    .sort((a, b) => Date.parse(a.start ?? '') - Date.parse(b.start ?? ''));
  for (const a of appointments) {
    const patientRef = a.participant?.map((p) => p.actor?.reference).find((r) => r?.startsWith('Patient/'));
    if (!patientRef) continue;
    const patient = await fhir<Patient>(patientRef);
    if (patient.telecom?.some((t) => t.system === 'phone')) return { appointmentRef: `Appointment/${a.id}`, patientRef };
  }
  fail(`no booked appointment today has a patient with a phone: set DEMO_PHONE_NUMBERS and run npm run fhir:reset -- demo-mock`);
}
