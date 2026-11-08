import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { FhirResource } from 'fhir/r4';
import { describe, expect, it, vi } from 'vitest';
import { AdapterProvider } from '@/lib/fhir/providers/adapter';
import { loadVendorDefinition } from '@/lib/fhir/providers/adapter/definition';
import type { InScopeType } from '@/lib/fhir/provider';

/**
 * Golden tests: a ClinicSoft record (tests/golden/clinicsoft/*.json, written
 * by hand) must map to exactly the expected FHIR through vendors/clinicsoft.yaml.
 */

const DIR = 'tests/golden/clinicsoft';
const BASE = 'https://clinicsoft.test/v2/practices/golden';
const ENDPOINT: Record<string, [path: string, key: string]> = {
  Patient: ['patients', 'patient'],
  Practitioner: ['providers', 'provider'],
  Organization: ['organizations', 'organization'],
  Appointment: ['schedule', 'appointment'],
  Encounter: ['encounters', 'encounter'],
  DocumentReference: ['documents', 'document'],
  Condition: ['problems', 'problem'],
  AllergyIntolerance: ['allergies', 'allergy'],
  MedicationRequest: ['prescriptions', 'prescription'],
  Observation: ['results', 'result'],
};

interface GoldenCase {
  note?: string;
  resourceType: InScopeType;
  vendor: Record<string, unknown>;
  expected: FhirResource;
}

const cases = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(path.join(DIR, f), 'utf8')) as GoldenCase] as const);

function adapterReturning(key: string, record: unknown) {
  process.env.GOLDEN_CLINICSOFT_KEY = 'golden-key';
  const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify({ [key]: record }), { status: 200 }),
  );
  const provider = new AdapterProvider(
    {
      clinicId: 'golden',
      name: 'golden',
      mode: 'adapter',
      baseUrl: null,
      auth: { type: 'apiKey', keyEnv: 'GOLDEN_CLINICSOFT_KEY' },
      adapterConfig: { vendor: 'clinicsoft', baseUrl: BASE },
      readOnly: true,
    },
    { fetch },
  );
  return { provider, fetch };
}

describe('ClinicSoft golden mappings', () => {
  it.each(cases)('%s', async (_name, c) => {
    const [endpoint, key] = ENDPOINT[c.resourceType];
    const { provider, fetch } = adapterReturning(key, c.vendor);
    const { meta, ...resource } = await provider.read(c.resourceType, c.expected.id!);
    expect(String(fetch.mock.calls[0][0])).toBe(`${BASE}/${endpoint}/${c.expected.id}`);
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get('X-API-Key')).toBe('golden-key');
    expect(meta?.versionId).toMatch(/^[0-9a-f]{16}$/); // content hash: ClinicSoft has no versions
    expect(resource).toEqual(c.expected);
  });

  it('covers every status, visit type, sex and encounter status code', () => {
    const seen = (field: string, type?: InScopeType) =>
      new Set(cases.filter(([, c]) => !type || c.resourceType === type).map(([, c]) => c.vendor[field]).filter((v) => v !== null && v !== undefined));
    const codes = loadVendorDefinition('clinicsoft').codes;
    expect([...seen('status', 'Appointment')].sort()).toEqual(Object.keys(codes.appointmentStatus).sort());
    expect([...seen('type')].sort()).toEqual(Object.keys(codes.visitMode).sort());
    expect([...seen('sex')].sort()).toEqual(Object.keys(codes.sex).sort());
    expect([...seen('encStatus')].sort()).toEqual(Object.keys(codes.encounterStatus).sort());
  });

  it('covers every code in the clinical code tables', () => {
    const codes = loadVendorDefinition('clinicsoft').codes;
    const seen = (type: InScopeType, ...fields: string[]) =>
      [...new Set(cases.filter(([, c]) => c.resourceType === type).flatMap(([, c]) => fields.map((f) => c.vendor[f])).filter((v) => v !== null && v !== undefined))].sort();
    expect(seen('Condition', 'status')).toEqual(Object.keys(codes.problemStatus).sort());
    expect(seen('AllergyIntolerance', 'status')).toEqual(Object.keys(codes.allergyStatus).sort());
    expect(seen('AllergyIntolerance', 'allergyType')).toEqual(Object.keys(codes.allergyType).sort());
    expect(seen('AllergyIntolerance', 'category')).toEqual(Object.keys(codes.allergyCategory).sort());
    expect(seen('AllergyIntolerance', 'severity1', 'severity2')).toEqual(Object.keys(codes.severity).sort());
    expect(seen('MedicationRequest', 'status')).toEqual(Object.keys(codes.rxStatus).sort());
    expect(seen('Observation', 'category')).toEqual(Object.keys(codes.resultCategory).sort());
    expect(seen('Observation', 'valueType')).toEqual(Object.keys(codes.resultValueType).sort());
  });

  it.each(Object.entries(loadVendorDefinition('clinicsoft').codes.encounterClass))(
    'encounter class %s -> %s',
    async (vendorClass, actCode) => {
      const record = { encounterNo: 'e', patientNo: 'p', startDateTime: '2026-01-01 10:00:00', encClass: vendorClass, encStatus: 'CLOSED' };
      const { provider } = adapterReturning('encounter', record);
      const enc = (await provider.read('Encounter', 'e')) as { class: { code: string } };
      expect(enc.class.code).toBe(actCode);
      expect(['AMB', 'EMER', 'IMP', 'HH', 'VR']).toContain(actCode);
    },
  );
});
