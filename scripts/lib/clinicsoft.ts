import { createHash } from 'node:crypto';
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
  type AllergySeverity,
  type ClinicSoftAllergy,
  type ClinicSoftEncounter,
  type ClinicSoftOrganization,
  type ClinicSoftPatient,
  type ClinicSoftPrescription,
  type ClinicSoftProblem,
  type ClinicSoftProvider,
  type ClinicSoftResult,
} from '@/lib/vendors/clinicsoft/rows';
import { fail } from './cli';
import { readCsv } from './csv';
import { syntheticHcn } from './hcn';
import { defaultCaps, medicationCutoff, type ClinicalCaps } from './synthea';

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
  problems: number;
  allergies: number;
  prescriptions: number;
  results: number;
  /** CSV rows left out by the clinical caps (same rules as the FHIR import). */
  droppedByCap: { prescriptions: number; results: number };
}

export async function loadClinicSoft(
  db: SupabaseClient,
  practiceId: string,
  csvDir: string,
  maxEncountersPerPatient: number,
  caps: ClinicalCaps = defaultCaps(),
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
    // Synthetic, and always fails the HCN check digit (scripts/lib/hcn.ts).
    healthCardNo: syntheticHcn(r.Id).number,
    healthCardVersion: syntheticHcn(r.Id).version,
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

  const clinical = clinicalRows(
    { conditions: csv('conditions'), allergies: csv('allergies'), medications: csv('medications'), observations: csv('observations') },
    new Set(encounters.map((e) => e.encounterNo)),
    caps,
    tz,
  );

  const practice = await cs.from('practices').upsert({ practice_id: practiceId, name: `Practice ${practiceId}` });
  if (practice.error) fail(`creating practice failed (${practice.error.code}): ${practice.error.message}`);
  const tables = ['results', 'prescriptions', 'allergies', 'problems', 'documents', 'schedule', 'encounters', 'patients', 'providers', 'organizations'];
  for (const table of tables) {
    const { error } = await cs.from(table).delete().eq('practice_id', practiceId);
    if (error) fail(`clearing clinicsoft.${table} failed (${error.code})`);
  }
  await insertAll(db, 'organizations', organizations.map((o) => withPractice(practiceId, o)));
  await insertAll(db, 'providers', providers.map((p) => providerRow(practiceId, p)));
  await insertAll(db, 'patients', patients.map((p) => patientRow(practiceId, p)));
  await insertAll(db, 'encounters', encounters.map((e) => withPractice(practiceId, e)));
  await insertAll(db, 'problems', clinical.problems.map((r) => withPractice(practiceId, r)));
  await insertAll(db, 'allergies', clinical.allergies.map((r) => withPractice(practiceId, r)));
  await insertAll(db, 'prescriptions', clinical.prescriptions.map((r) => withPractice(practiceId, r)));
  await insertAll(db, 'results', clinical.results.map((r) => withPractice(practiceId, r)));
  return {
    organizations: organizations.length,
    providers: providers.length,
    patients: patients.length,
    encounters: encounters.length,
    problems: clinical.problems.length,
    allergies: clinical.allergies.length,
    prescriptions: clinical.prescriptions.length,
    results: clinical.results.length,
    droppedByCap: clinical.droppedByCap,
  };
}

type CsvRow = Record<string, string>;

const BP_PANEL = { code: '85354-9', name: 'Blood pressure panel with all children optional' };
const SYSTOLIC = '8480-6';
const DIASTOLIC = '8462-4';
const RESULT_CATEGORY: Record<string, ClinicSoftResult['category']> = { 'vital-signs': 'VS', laboratory: 'LAB' };
const ALLERGY_CATEGORY: Record<string, ClinicSoftAllergy['category']> = {
  food: 'FOOD',
  medication: 'DRUG',
  environment: 'ENV',
  biologic: 'BIO',
};
const SEVERITY: Record<string, AllergySeverity> = { MILD: 'MILD', MODERATE: 'MOD', SEVERE: 'SEV' };

/**
 * CSV rows have no ids, so ClinicSoft ids are a hash of what identifies the
 * row (UUID-shaped), plus an ordinal for exact duplicates. Same CSV in, same
 * ids out, so links survive a reload.
 */
export class StableIds {
  private readonly seen = new Map<string, number>();
  next(kind: string, parts: (string | null | undefined)[]): string {
    const key = [kind, ...parts.map((p) => p ?? '')].join('|');
    const n = this.seen.get(key) ?? 0;
    this.seen.set(key, n + 1);
    const hex = createHash('sha256').update(n === 0 ? key : `${key}|${n}`).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }
}

/**
 * Synthea clinical CSVs -> ClinicSoft rows, with the same caps as the FHIR
 * import: every problem and allergy, prescriptions started inside the
 * medication window, and vital-sign/lab results, latest N per LOINC code per
 * patient. Blood pressure arrives as separate systolic/diastolic rows and is
 * stored the ClinicSoft way, as one "120/80" row (FHIR has one panel
 * Observation). Links to encounters that weren't loaded are left empty.
 */
export function clinicalRows(
  csv: { conditions: CsvRow[]; allergies: CsvRow[]; medications: CsvRow[]; observations: CsvRow[] },
  loadedEncounters: Set<string>,
  caps: ClinicalCaps,
  tz: string,
) {
  const ids = new StableIds();
  const enc = (id: string) => (id && loadedEncounters.has(id) ? id : null);
  const local = (iso: string) => formatLocal(iso, tz, 'YYYY-MM-DD HH:mm:ss')!;

  const problems: ClinicSoftProblem[] = csv.conditions.map((r) => ({
    problemId: ids.next('problem', [r.PATIENT, r.ENCOUNTER, r.CODE, r.START]),
    patientNo: r.PATIENT,
    encounterNo: enc(r.ENCOUNTER),
    onsetDate: r.START,
    resolvedDate: r.STOP || null,
    status: r.STOP ? 'R' : 'A',
    snomedCode: r.CODE,
    description: r.DESCRIPTION,
  }));

  const allergies: ClinicSoftAllergy[] = csv.allergies.map((r) => ({
    allergyId: ids.next('allergy', [r.PATIENT, r.ENCOUNTER, r.CODE, r.START]),
    patientNo: r.PATIENT,
    encounterNo: enc(r.ENCOUNTER),
    onsetDate: r.START,
    endDate: r.STOP || null,
    status: r.STOP ? 'I' : 'A',
    allergenCode: r.CODE,
    allergen: r.DESCRIPTION,
    allergyType: r.TYPE === 'allergy' ? 'ALLERGY' : r.TYPE === 'intolerance' ? 'INTOLERANCE' : null,
    category: ALLERGY_CATEGORY[r.CATEGORY] ?? null,
    reaction1Code: r.REACTION1 || null,
    reaction1: r.DESCRIPTION1 || null,
    severity1: SEVERITY[r.SEVERITY1] ?? null,
    reaction2Code: r.REACTION2 || null,
    reaction2: r.DESCRIPTION2 || null,
    severity2: SEVERITY[r.SEVERITY2] ?? null,
  }));

  const cutoff = medicationCutoff(caps).getTime();
  const keptMedications = csv.medications.filter((r) => Date.parse(r.START) >= cutoff);
  const prescriptions: ClinicSoftPrescription[] = keptMedications.map((r) => ({
    rxId: ids.next('rx', [r.PATIENT, r.ENCOUNTER, r.CODE, r.START]),
    patientNo: r.PATIENT,
    encounterNo: enc(r.ENCOUNTER),
    startDateTime: local(r.START),
    stopDateTime: r.STOP ? local(r.STOP) : null,
    status: r.STOP ? 'C' : 'A',
    rxnormCode: r.CODE,
    drugName: r.DESCRIPTION,
    sig: null,
    reasonCode: r.REASONCODE || null,
    reasonDesc: r.REASONDESCRIPTION || null,
  }));

  // Vital signs and labs only; systolic + diastolic of one reading become one BP row.
  const wanted = csv.observations.filter((r) => caps.observationCategories.includes(r.CATEGORY));
  const readings: CsvRow[] = [];
  const bp = new Map<string, { systolic?: CsvRow; diastolic?: CsvRow }>();
  for (const r of wanted) {
    if (r.CODE !== SYSTOLIC && r.CODE !== DIASTOLIC) {
      readings.push(r);
      continue;
    }
    const key = `${r.PATIENT}|${r.ENCOUNTER}|${r.DATE}`;
    const pair = bp.get(key) ?? {};
    if (r.CODE === SYSTOLIC) pair.systolic = r;
    else pair.diastolic = r;
    bp.set(key, pair);
  }
  for (const { systolic, diastolic } of bp.values()) {
    if (systolic && diastolic) {
      readings.push({
        ...systolic,
        CODE: BP_PANEL.code,
        DESCRIPTION: BP_PANEL.name,
        VALUE: `${systolic.VALUE}/${diastolic.VALUE}`,
        TYPE: 'bp',
      });
    } else {
      for (const r of [systolic, diastolic]) if (r) readings.push(r);
    }
  }
  // Latest N per (patient, LOINC code).
  const byCode = new Map<string, CsvRow[]>();
  for (const r of readings) {
    const key = `${r.PATIENT}|${r.CODE}`;
    byCode.set(key, [...(byCode.get(key) ?? []), r]);
  }
  const keptReadings = [...byCode.values()].flatMap((list) =>
    list.sort((a, b) => b.DATE.localeCompare(a.DATE)).slice(0, caps.observationsPerCode),
  );
  const results: ClinicSoftResult[] = keptReadings.map((r) => ({
    resultId: ids.next('result', [r.PATIENT, r.ENCOUNTER, r.CODE, r.DATE]),
    patientNo: r.PATIENT,
    encounterNo: enc(r.ENCOUNTER),
    resultDateTime: local(r.DATE),
    category: RESULT_CATEGORY[r.CATEGORY],
    testCode: r.CODE,
    testName: r.DESCRIPTION,
    value: r.VALUE || null,
    units: r.UNITS || null,
    valueType: r.TYPE === 'bp' ? 'BP' : r.TYPE === 'numeric' ? 'N' : 'T',
  }));

  return {
    problems,
    allergies,
    prescriptions,
    results,
    droppedByCap: {
      prescriptions: csv.medications.length - keptMedications.length,
      results: csv.observations.length - wanted.length + (readings.length - keptReadings.length),
    },
  };
}

export function clinicSoftSummary(s: ClinicSoftLoadStats): string {
  return (
    `organizations=${s.organizations} providers=${s.providers} patients=${s.patients} encounters=${s.encounters} ` +
    `problems=${s.problems} allergies=${s.allergies} prescriptions=${s.prescriptions} results=${s.results}; ` +
    `dropped by caps: prescriptions=${s.droppedByCap.prescriptions} result rows=${s.droppedByCap.results}`
  );
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
