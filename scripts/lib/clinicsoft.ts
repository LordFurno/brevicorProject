import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatLocal } from '@/lib/fhir/providers/adapter/helpers';
import { defaultTimeZone } from '@/lib/fhir/search';
import {
  CLINICSOFT_SCHEMA,
  isoToDdmmyyyy,
  patientRow,
  providerRow,
  withPractice,
  type ClinicSoftEncounter,
  type ClinicSoftOrganization,
  type ClinicSoftPatient,
  type ClinicSoftProvider,
} from '@/lib/vendors/clinicsoft/rows';
import { fail } from './cli';
import { readCsv } from './csv';

/**
 * Loads Synthea CSV output into a ClinicSoft practice, in ClinicSoft's own
 * shapes. Synthea CSV ids equal the FHIR resource ids, so vendor numbers
 * (patientNo, providerNo, ...) are the same ids demo-mock uses. Phone numbers
 * are never loaded: the appointment seed assigns DEMO_PHONE_NUMBERS.
 */

export const DEMO_CLINICSOFT_PRACTICE = 'demo';
export const DEFAULT_CSV_DIR = './synthea-output/csv';

export interface ClinicSoftLoadStats {
  organizations: number;
  providers: number;
  patients: number;
  encounters: number;
}

export async function loadClinicSoft(
  db: SupabaseClient,
  practiceId: string,
  csvDir: string,
  maxEncountersPerPatient: number,
): Promise<ClinicSoftLoadStats> {
  const cs = db.schema(CLINICSOFT_SCHEMA);
  const tz = defaultTimeZone();
  const csv = (name: string) => {
    try {
      return readCsv(join(csvDir, `${name}.csv`));
    } catch {
      return fail(`cannot read ${join(csvDir, `${name}.csv`)}: generate Synthea output with CSV export (see README)`);
    }
  };

  const organizations: ClinicSoftOrganization[] = csv('organizations').map((r) => ({
    orgId: r.Id,
    orgName: r.NAME,
    licenceNo: r.Id,
    phone: r.PHONE || null,
    address1: r.ADDRESS || null,
    city: r.CITY || null,
    province: stateCode(r.STATE),
    postalCode: r.ZIP || null,
  }));

  const providers: ClinicSoftProvider[] = csv('providers').map((r) => {
    const space = r.NAME.lastIndexOf(' ');
    return {
      providerNo: r.Id,
      title: 'Dr.', // Synthea's CSV has no prefix; its FHIR export always uses "Dr."
      firstName: space === -1 ? null : r.NAME.slice(0, space),
      lastName: space === -1 ? r.NAME : r.NAME.slice(space + 1),
      sex: sexCode(r.GENDER),
      specialty: r.SPECIALITY || null,
      cpsoNo: r.NPI || null,
      orgId: r.ORGANIZATION || null,
    };
  });

  const patients: ClinicSoftPatient[] = csv('patients').map((r) => ({
    patientNo: r.Id,
    chartNo: r.Id, // Synthea's MRN is the patient id
    title: r.PREFIX || null,
    lastName: r.LAST,
    firstName: r.FIRST || null,
    middleName: r.MIDDLE || null,
    suffix: r.SUFFIX || null,
    dob: r.BIRTHDATE ? isoToDdmmyyyy(r.BIRTHDATE) : null,
    sex: sexCode(r.GENDER),
    cellPhone: null,
    homePhone: null,
    email: null,
    address1: r.ADDRESS || null,
    city: r.CITY || null,
    province: stateCode(r.STATE),
    postalCode: r.ZIP || null,
    deceasedDate: r.DEATHDATE ? isoToDdmmyyyy(r.DEATHDATE.slice(0, 10)) : null,
  }));

  // Same selection as the FHIR import: the most recent N encounters per patient.
  const byPatient = new Map<string, Record<string, string>[]>();
  for (const r of csv('encounters')) byPatient.set(r.PATIENT, [...(byPatient.get(r.PATIENT) ?? []), r]);
  const encounters: ClinicSoftEncounter[] = [...byPatient.values()].flatMap((rows) =>
    rows
      .sort((a, b) => b.START.localeCompare(a.START))
      .slice(0, maxEncountersPerPatient)
      .map((r) => ({
        encounterNo: r.Id,
        patientNo: r.PATIENT,
        providerNo: r.PROVIDER || null,
        orgId: r.ORGANIZATION || null,
        apptId: null,
        startDateTime: formatLocal(r.START, tz, 'YYYY-MM-DD HH:mm:ss')!,
        endDateTime: r.STOP ? formatLocal(r.STOP, tz, 'YYYY-MM-DD HH:mm:ss')! : null,
        encClass: r.ENCOUNTERCLASS,
        encStatus: r.STOP ? ('CLOSED' as const) : ('OPEN' as const),
        encTypeCode: r.CODE || null,
        encTypeDesc: r.DESCRIPTION || null,
      })),
  );

  const practice = await cs.from('practices').upsert({ practice_id: practiceId, name: `Practice ${practiceId}` });
  if (practice.error) fail(`creating practice failed (${practice.error.code}): ${practice.error.message}`);
  for (const table of ['documents', 'schedule', 'encounters', 'patients', 'providers', 'organizations']) {
    const { error } = await cs.from(table).delete().eq('practice_id', practiceId);
    if (error) fail(`clearing clinicsoft.${table} failed (${error.code})`);
  }
  await insertAll(db, 'organizations', organizations.map((o) => withPractice(practiceId, o)));
  await insertAll(db, 'providers', providers.map((p) => providerRow(practiceId, p)));
  await insertAll(db, 'patients', patients.map((p) => patientRow(practiceId, p)));
  await insertAll(db, 'encounters', encounters.map((e) => withPractice(practiceId, e)));
  return { organizations: organizations.length, providers: providers.length, patients: patients.length, encounters: encounters.length };
}

export async function insertAll(db: SupabaseClient, table: string, rows: object[], batchSize = 500): Promise<void> {
  for (let i = 0; i < rows.length; i += batchSize) {
    const { error } = await db.schema(CLINICSOFT_SCHEMA).from(table).insert(rows.slice(i, i + batchSize));
    if (error) fail(`inserting into clinicsoft.${table} failed (${error.code}): ${error.message}`);
  }
}

/** `--no-clinicsoft` -> undefined; `--clinicsoft=<practice>` -> that practice; default 'demo'. */
export function clinicSoftOption(args: string[]): string | undefined {
  if (args.includes('--no-clinicsoft')) return undefined;
  const flag = args.find((a) => a.startsWith('--clinicsoft='));
  return flag ? flag.slice('--clinicsoft='.length) : DEMO_CLINICSOFT_PRACTICE;
}

/** True when the practice exists and has patients loaded. */
export async function clinicSoftLoaded(db: SupabaseClient, practiceId: string): Promise<boolean> {
  const { count, error } = await db
    .schema(CLINICSOFT_SCHEMA)
    .from('patients')
    .select('patientNo', { count: 'exact', head: true })
    .eq('practice_id', practiceId);
  return !error && (count ?? 0) > 0;
}

function sexCode(gender: string): 'M' | 'F' | 'U' | null {
  return gender === 'M' || gender === 'F' ? gender : gender ? 'U' : null;
}

/** ClinicSoft stores two-letter region codes; Synthea's CSV has full US state names. */
function stateCode(name: string): string | null {
  if (!name) return null;
  return US_STATES[name] ?? name;
}

const US_STATES: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT',
  Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL',
  Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT',
  Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA',
  'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT',
  Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
};
