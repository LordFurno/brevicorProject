import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AllergyIntolerance,
  Appointment,
  Condition,
  FhirResource,
  MedicationRequest,
  Observation,
  Patient,
  Practitioner,
} from 'fhir/r4';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AdapterProvider } from '@/lib/fhir/providers/adapter';
import { MockProvider } from '@/lib/fhir/providers/mock';
import { ONTARIO_HCN_SYSTEM } from '@/lib/fhir/identifiers';
import type { EhrConnection, EhrProvider, InScopeType } from '@/lib/fhir/provider';
import { handleClinicSoftRequest } from '@/lib/vendors/clinicsoft/api';
import { CLINICSOFT_SCHEMA } from '@/lib/vendors/clinicsoft/rows';
import { localDate } from '@/scripts/lib/appointments';

/**
 * demo-mock (native FHIR from Synthea) and demo-clinicsoft (ClinicSoft rows
 * from Synthea CSV, mapped by vendors/clinicsoft.yaml) hold the same seeded
 * appointment plan and patients. Everything the adapter maps must equal the
 * native FHIR. Fields that legitimately differ are listed below and in
 * docs/adapter-guide.md.
 *
 * Needs `npm run fhir:reset -- demo-mock` (or clinicsoft:load + fhir:seed) to have run today.
 */

/** ClinicSoft has nowhere to store these, so the adapter can't produce them. */
const APPOINTMENT_DIFFERS = ['meta', 'created', 'appointmentType', 'cancelationReason'];
const PATIENT_DIFFERS = ['meta', 'text', 'extension', 'maritalStatus', 'multipleBirthBoolean', 'multipleBirthInteger', 'communication'];

/**
 * Clinical history is compared by what identifies a clinical fact: code, dates
 * and status (plus values for results). Fields that legitimately differ
 * (docs/adapter-guide.md section 10): ClinicSoft holds no verification status
 * or category on problems, at most two allergy reactions (Synthea's CSV export
 * limit), no criticality, no dosage text, no `issued`, and date-only problem
 * and allergy dates (compared by day). Text results are compared by text (valueString or valueCodeableConcept);
 * numeric results within 0.05, because Synthea's CSV export rounds values to
 * one decimal (37.049 Cel in FHIR is 37.0 in the CSV).
 */
const VALUE_TOLERANCE = 0.05 + 1e-9;
const CLINICAL_TYPES = ['Condition', 'AllergyIntolerance', 'MedicationRequest', 'Observation'] as const;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const TZ = 'America/Toronto';

describe.skipIf(!url || !key)('demo-clinicsoft is equivalent to demo-mock', () => {
  let db: SupabaseClient;
  let mock: MockProvider;
  let adapter: AdapterProvider;
  let appointmentIds: string[] = [];

  beforeAll(async () => {
    db = createClient(url!, key!, { auth: { persistSession: false } });
    mock = new MockProvider(db, 'demo-mock');
    const { data: row, error } = await db.from('ehr_connections').select('auth, adapter_config').eq('clinic_id', 'demo-clinicsoft').single();
    if (error) throw new Error(`demo-clinicsoft connection missing: ${error.message}`);
    const apiKey = 'equivalence-test-key';
    vi.stubEnv('CLINICSOFT_EQUIVALENCE_KEY', apiKey);
    // The real connection config (identifier systems etc.), but calling the vendor in-process.
    const conn: EhrConnection = {
      clinicId: 'demo-clinicsoft',
      name: 'demo-clinicsoft',
      mode: 'adapter',
      baseUrl: null,
      auth: { type: 'apiKey', keyEnv: 'CLINICSOFT_EQUIVALENCE_KEY' },
      adapterConfig: { ...(row.adapter_config as object), baseUrl: 'http://vendor.test/api/mock-vendors/clinicsoft/v2/practices/demo' },
      readOnly: true,
    };
    const vendorFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(input));
      return handleClinicSoftRequest(new Request(u, init), u.pathname.replace(/^\/api\/mock-vendors\/clinicsoft\/v2\//, '').split('/'), { db, apiKey });
    }) as typeof fetch;
    adapter = new AdapterProvider(conn, { fetch: vendorFetch });

    const today = localDate(new Date(), TZ);
    const bundle = await mock.search('Appointment', { params: [['date', `ge${today}`]], count: 100, offset: 0 });
    appointmentIds = (bundle.entry ?? []).map((e) => e.resource!.id!);
    const { count } = await db.schema(CLINICSOFT_SCHEMA).from('schedule').select('apptId', { count: 'exact', head: true }).eq('practice_id', 'demo');
    if (appointmentIds.length === 0 || !count) {
      throw new Error('no seeded appointments in demo-mock and ClinicSoft: run `npm run fhir:reset -- demo-mock` first');
    }
  });

  it('every seeded appointment: the fields the app relies on are identical', async () => {
    expect(appointmentIds.length).toBeGreaterThanOrEqual(10);
    for (const id of appointmentIds) {
      const m = (await mock.read('Appointment', id)) as Appointment;
      const a = (await adapter.read('Appointment', id)) as Appointment;
      expect(Date.parse(a.start!), `${id} start`).toBe(Date.parse(m.start!));
      expect(Date.parse(a.end!), `${id} end`).toBe(Date.parse(m.end!));
      expect(a.status, `${id} status`).toBe(m.status);
      expect(actors(a), `${id} participants`).toEqual(actors(m));
      expect(visitMode(a), `${id} visit mode`).toEqual(visitMode(m));
      expect(visitMode(a)?.code).toMatch(/^(video|telephone)$/);
    }
  });

  it('every seeded appointment: the whole resource matches apart from documented fields', async () => {
    for (const id of appointmentIds) {
      const m = withoutFields((await mock.read('Appointment', id)) as Appointment, APPOINTMENT_DIFFERS) as Appointment;
      const a = withoutFields((await adapter.read('Appointment', id)) as Appointment, APPOINTMENT_DIFFERS) as Appointment;
      // participant.required: ClinicSoft doesn't record it.
      m.participant = m.participant.map(({ required: _r, ...p }) => p);
      expect(a, id).toEqual(m);
    }
  });

  it("every booked patient: name, birthDate, telecom (phone + email) and MRN are identical; the rest matches the adapter's fields", async () => {
    const patientIds = new Set<string>();
    for (const id of appointmentIds) {
      const appt = (await mock.read('Appointment', id)) as Appointment;
      patientIds.add(appt.participant.find((p) => p.actor?.reference?.startsWith('Patient/'))!.actor!.reference!.split('/')[1]);
    }
    let withPhone = 0;
    let withEmail = 0;
    for (const id of patientIds) {
      const m = (await mock.read('Patient', id)) as Patient;
      const a = (await adapter.read('Patient', id)) as Patient;
      expect(officialName(a), `${id} name`).toEqual(officialName(m));
      expect(a.birthDate, `${id} birthDate`).toBe(m.birthDate);
      expect(a.telecom ?? [], `${id} telecom`).toEqual(m.telecom ?? []);
      expect(contact(a, 'phone'), `${id} phone`).toEqual(contact(m, 'phone'));
      expect(contact(a, 'email'), `${id} email`).toEqual(contact(m, 'email'));
      expect(mrn(a), `${id} MRN`).toEqual(mrn(m));
      expect(mrn(a)?.value).toBeTruthy();
      expect(hcn(a), `${id} HCN`).toEqual(hcn(m));
      expect(hcn(a)?.value).toMatch(/^\d{10}$/);
      if (contact(a, 'phone').length) withPhone += 1;
      if (contact(a, 'email').length) withEmail += 1;

      // Native FHIR projected onto what ClinicSoft can hold.
      const projected = withoutFields(m, PATIENT_DIFFERS) as Patient;
      projected.identifier = m.identifier?.filter((i) => i === mrnOf(m) || i.system === ONTARIO_HCN_SYSTEM);
      projected.name = [officialName(m)!];
      projected.address = m.address?.map(({ country: _c, extension: _e, ...rest }) => rest);
      expect(withoutFields(a, ['meta']), id).toEqual(projected);
    }
    // Only DEMO_PHONE_NUMBERS / DEMO_EMAILS ever appear, and only when set; both EHRs agree either way.
    const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    expect(withPhone).toBeLessThanOrEqual(list(process.env.DEMO_PHONE_NUMBERS).length);
    expect(withEmail).toBeLessThanOrEqual(list(process.env.DEMO_EMAILS).length);
  });

  it('every booked patient: conditions, allergies, medications and results match by code, dates and status', async () => {
    const patientIds = new Set<string>();
    for (const id of appointmentIds) {
      const appt = (await mock.read('Appointment', id)) as Appointment;
      patientIds.add(appt.participant.find((p) => p.actor?.reference?.startsWith('Patient/'))!.actor!.reference!.split('/')[1]);
    }
    const totals: Record<string, number> = {};
    for (const id of patientIds) {
      for (const type of CLINICAL_TYPES) {
        const facts = async (p: EhrProvider) =>
          (await everything(p, type, id)).map(clinicalFact).sort((x, y) => x.key.localeCompare(y.key) || x.values[0] - y.values[0]);
        const m = await facts(mock);
        const a = await facts(adapter);
        expect(a.map((f) => f.key), `${type} for Patient/${id}`).toEqual(m.map((f) => f.key));
        a.forEach((f, i) => {
          expect(f.values.length, f.key).toBe(m[i].values.length);
          f.values.forEach((v, j) => expect(Math.abs(v - m[i].values[j]), `${f.key} value`).toBeLessThanOrEqual(VALUE_TOLERANCE));
        });
        totals[type] = (totals[type] ?? 0) + m.length;
      }
    }
    // The demo patients really do have history in every section.
    for (const type of CLINICAL_TYPES) expect(totals[type], type).toBeGreaterThan(0);
  });

  it('every booked practitioner: name, licence identifier and gender match', async () => {
    const ids = new Set<string>();
    for (const id of appointmentIds) {
      const appt = (await mock.read('Appointment', id)) as Appointment;
      ids.add(appt.participant.find((p) => p.actor?.reference?.startsWith('Practitioner/'))!.actor!.reference!.split('/')[1]);
    }
    for (const id of ids) {
      const m = (await mock.read('Practitioner', id)) as Practitioner;
      const a = (await adapter.read('Practitioner', id)) as Practitioner;
      expect(a.name, id).toEqual(m.name?.map(({ family, given, prefix }) => ({ family, given, prefix })));
      expect(a.identifier, id).toEqual(m.identifier?.map(({ system, value }) => ({ system, value })));
      expect(a.gender, id).toBe(m.gender);
    }
  });
});

function actors(a: Appointment): string[] {
  return a.participant.map((p) => p.actor?.reference ?? '').sort();
}

function visitMode(a: Appointment) {
  const coding = a.serviceType?.[0]?.coding?.find((c) => c.system === 'https://brevicor.ca/fhir/CodeSystem/consultation-modality');
  return coding && { system: coding.system, code: coding.code };
}

function contact(p: Patient, system: 'phone' | 'email') {
  return (p.telecom ?? []).filter((t) => t.system === system).map((t) => t.value);
}

function officialName(p: Patient) {
  return p.name?.find((n) => n.use === 'official') ?? p.name?.[0];
}

function mrnOf(p: Patient) {
  return p.identifier?.find((i) => i.type?.coding?.some((c) => c.code === 'MR'));
}

function mrn(p: Patient) {
  const id = mrnOf(p);
  return id && { system: id.system, value: id.value, code: 'MR' };
}

function hcn(p: Patient) {
  const id = p.identifier?.find((i) => i.system === ONTARIO_HCN_SYSTEM);
  return id && { system: id.system, value: id.value, version: id.extension?.[0]?.valueString, type: id.type?.coding?.[0]?.code };
}

/** Every resource of a type for one patient, following pages. */
async function everything(provider: EhrProvider, type: InScopeType, patientId: string): Promise<FhirResource[]> {
  const out: FhirResource[] = [];
  for (let offset = 0; ; offset += 100) {
    const bundle = await provider.search(type, { params: [['patient', `Patient/${patientId}`]], count: 100, offset });
    const page = (bundle.entry ?? []).map((e) => e.resource as FhirResource);
    out.push(...page);
    if (page.length < 100) return out;
  }
}

const day = (v: string | undefined) => v?.slice(0, 10) ?? '';
const instant = (v: string | undefined) => (v ? String(Date.parse(v)) : '');
const firstCode = (cc: { coding?: { code?: string }[] } | undefined) => cc?.coding?.[0]?.code ?? '';

/** What identifies a clinical fact, independent of how each EHR stores it; numeric values separately. */
function clinicalFact(r: FhirResource): { key: string; values: number[] } {
  switch (r.resourceType) {
    case 'Condition': {
      const c = r as Condition;
      return { key: [firstCode(c.code), day(c.onsetDateTime), day(c.abatementDateTime), firstCode(c.clinicalStatus)].join('|'), values: [] };
    }
    case 'AllergyIntolerance': {
      const a = r as AllergyIntolerance;
      return { key: [firstCode(a.code), day(a.recordedDate), firstCode(a.clinicalStatus), a.type ?? '', (a.category ?? []).join(',')].join('|'), values: [] };
    }
    case 'MedicationRequest': {
      const m = r as MedicationRequest;
      return { key: [firstCode(m.medicationCodeableConcept), instant(m.authoredOn), m.status, m.intent].join('|'), values: [] };
    }
    case 'Observation': {
      const o = r as Observation;
      const quantities = o.valueQuantity ? [o.valueQuantity] : (o.component ?? []).map((c) => c.valueQuantity ?? {});
      // Text results: FHIR may use valueString or valueCodeableConcept; Synthea's CSV writes commas as spaces.
      const text = o.valueString ?? o.valueCodeableConcept?.text;
      const shape = text !== undefined
        ? `text:${text.replace(/,/g, ' ')}`
        : [...(o.component ?? []).map((c) => firstCode(c.code)), ...quantities.map((q) => q.unit ?? '')].join(',');
      return {
        key: [o.code.coding?.find((c) => c.system === 'http://loinc.org')?.code, instant(o.effectiveDateTime), firstCode(o.category?.[0]), o.status, shape].join('|'),
        values: quantities.map((q) => q.value ?? NaN),
      };
    }
    default:
      throw new Error(`unexpected ${r.resourceType}`);
  }
}

function withoutFields<T extends FhirResource>(r: T, fields: string[]): Partial<T> {
  const copy: Record<string, unknown> = { ...r };
  for (const f of fields) delete copy[f];
  return copy as Partial<T>;
}
