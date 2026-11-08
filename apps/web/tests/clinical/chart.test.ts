import type * as fhir4 from 'fhir/r4';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fhirSource } from '../../src/lib/clinical/fhir-source';
import { loadChart } from '../../src/lib/clinical';
import { formatHealthCard, mapChart, type FhirChartBundle } from '../../src/lib/clinical/map';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const HCN = 'https://fhir.infoway-inforoute.ca/NamingSystem/ca-on-patient-hcn';
const VERSION_EXT = 'http://hl7.org/fhir/ca/baseline/StructureDefinition/ext-identifierversion';
const LOINC = 'http://loinc.org';
const vitalSigns = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }];

const patient: fhir4.Patient = {
  resourceType: 'Patient',
  id: 'p1',
  name: [{ use: 'official', given: ['Wren'], family: 'Synthetic' }],
  birthDate: '1990-09-09',
  identifier: [
    { type: { coding: [{ code: 'MR' }] }, system: 'http://hospital.smarthealthit.org', value: 'MRN-1' },
    { system: HCN, value: '2345678905', extension: [{ url: VERSION_EXT, valueString: 'AB' }] },
  ],
};

function bundle(overrides: Partial<FhirChartBundle> = {}): FhirChartBundle {
  return { patient, conditions: [], allergies: [], medications: [], observations: [], encounters: [], documents: [], ...overrides };
}

describe('mapChart', () => {
  it('reads the Ontario HCN by its official system, with the version code', () => {
    expect(mapChart(bundle(), { matched: true, source: 'fhir' }).patient.healthCard).toBe('2345 678 905 AB');
  });

  it('accepts the legacy eHealth Ontario HCN system and never shows an MRN as the health card', () => {
    const legacy = { ...patient, identifier: [{ system: 'http://ehealthontario.ca/API/FHIR/NamingSystem/ca-on-patient-hcn', value: '1234567890' }] };
    expect(mapChart(bundle({ patient: legacy }), { matched: true, source: 'fhir' }).patient.healthCard).toBe('1234 567 890');
    const mrnOnly = { ...patient, identifier: [patient.identifier![0]] };
    expect(mapChart(bundle({ patient: mrnOnly }), { matched: true, source: 'fhir' }).patient.healthCard).toBeUndefined();
    expect(formatHealthCard('123')).toBe('123');
  });

  it('maps current MedicationRequests with dosage instructions', () => {
    const med = (status: fhir4.MedicationRequest['status'], text: string): fhir4.MedicationRequest => ({
      resourceType: 'MedicationRequest',
      status,
      intent: 'order',
      subject: { reference: 'Patient/p1' },
      medicationCodeableConcept: { text },
      dosageInstruction: [{ text: 'Take as needed.' }],
    });
    const chart = mapChart(bundle({ medications: [med('active', 'Metformin'), med('completed', 'Amoxicillin')] }), { matched: true, source: 'fhir' });
    expect(chart.medications).toEqual([{ name: 'Metformin', dosage: 'Take as needed.', status: 'active' }]);
  });

  it('shows blood pressure panels and text results', () => {
    const bp: fhir4.Observation = {
      resourceType: 'Observation',
      status: 'final',
      category: vitalSigns,
      code: { text: 'Blood pressure panel with all children optional', coding: [{ system: LOINC, code: '85354-9' }] },
      effectiveDateTime: '2026-07-01T14:15:00Z',
      component: [
        { code: { coding: [{ system: LOINC, code: '8462-4' }] }, valueQuantity: { value: 74, unit: 'mm[Hg]' } },
        { code: { coding: [{ system: LOINC, code: '8480-6' }] }, valueQuantity: { value: 117, unit: 'mm[Hg]' } },
      ],
    };
    const culture: fhir4.Observation = {
      resourceType: 'Observation',
      status: 'final',
      category: [{ coding: [{ code: 'laboratory' }] }],
      code: { text: 'Bacteria identified in Urine by Culture' },
      valueString: 'Greater than 100,000 colony forming units per mL',
    };
    const chart = mapChart(bundle({ observations: [bp, culture] }), { matched: true, source: 'fhir' });
    expect(chart.vitals[0]).toMatchObject({ value: '117/74', unit: 'mm[Hg]' });
    expect(chart.labs[0]).toMatchObject({ value: 'Greater than 100,000 colony forming units per mL' });
  });

  it('leaves inactive allergies out', () => {
    const allergy = (status: string, text: string): fhir4.AllergyIntolerance => ({
      resourceType: 'AllergyIntolerance',
      patient: { reference: 'Patient/p1' },
      clinicalStatus: { coding: [{ code: status }] },
      code: { text },
    });
    const chart = mapChart(bundle({ allergies: [allergy('active', 'Peanuts'), allergy('inactive', 'Penicillin')] }), { matched: true, source: 'fhir' });
    expect(chart.allergies.map((a) => a.substance)).toEqual(['Peanuts']);
  });
});

/** A gateway whose CapabilityStatement lists `types`, answering searches from `results`. */
function fakeGateway(types: Record<string, string[]>, results: Record<string, fhir4.FhirResource[] | number>) {
  const urls: string[] = [];
  vi.stubEnv('FHIR_BASE_URL', 'http://gateway.test/api/fhir/R4');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input));
    urls.push(url.pathname.replace('/api/fhir/R4/', '') + url.search);
    const [, type] = /\/R4\/([A-Za-z]+)/.exec(url.pathname) ?? [];
    if (url.pathname.endsWith('/metadata')) {
      return Response.json({
        resourceType: 'CapabilityStatement',
        rest: [{ mode: 'server', resource: Object.entries(types).map(([t, params]) => ({ type: t, interaction: [{ code: 'read' }, { code: 'search-type' }], searchParam: params.map((name) => ({ name })) })) }],
      });
    }
    if (url.pathname.endsWith('/Patient/p1')) return Response.json(patient);
    const r = results[type] ?? [];
    if (typeof r === 'number') return new Response('{}', { status: r });
    return Response.json({ resourceType: 'Bundle', type: 'searchset', entry: r.map((resource) => ({ resource })) });
  });
  return urls;
}

describe('fhirSource sections', () => {
  const lookup = { patientRef: 'Patient/p1', clinicId: 'demo-clinicsoft', accessToken: 'physician-token', name: 'x', dateOfBirth: '1990-09-09' };

  it('marks types the clinic does not offer as unavailable, without querying them', async () => {
    const urls = fakeGateway(
      { Condition: ['patient', 'clinical-status'], AllergyIntolerance: ['patient'], Observation: ['patient', 'category'], Encounter: ['patient'], DocumentReference: ['patient'] },
      { Condition: [{ resourceType: 'Condition', subject: { reference: 'Patient/p1' }, code: { text: 'Asthma' } }] },
    );
    const chart = await fhirSource.getChart(lookup);
    expect(chart.sections).toEqual({ conditions: 'ok', allergies: 'ok', medications: 'unavailable', vitals: 'ok', labs: 'ok', visits: 'ok' });
    expect(chart.conditions.map((c) => c.name)).toEqual(['Asthma']);
    expect(urls.some((u) => u.startsWith('MedicationRequest'))).toBe(false);
    // Filters go out only where the clinic declares the param.
    expect(urls).toContain('Condition?patient=Patient%2Fp1&clinical-status=active&_count=100');
    expect(urls).toContain('Observation?patient=Patient%2Fp1&category=vital-signs%2Claboratory&_count=100');
  });

  it('reports a failed search as an error, not as "none recorded"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fakeGateway(
      { Condition: ['patient'], AllergyIntolerance: ['patient'], MedicationRequest: ['patient', 'status'], Observation: ['patient'], Encounter: ['patient'], DocumentReference: ['patient'] },
      { AllergyIntolerance: 502 },
    );
    const chart = await fhirSource.getChart(lookup);
    expect(chart.sections.allergies).toBe('error');
    expect(chart.sections.medications).toBe('ok');
  });

  it('loadChart marks every section as errored when the patient cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('FHIR_BASE_URL', 'http://gateway.test/api/fhir/R4');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }));
    const chart = await loadChart(lookup);
    expect(chart.error).toBeTruthy();
    expect(new Set(Object.values(chart.sections))).toEqual(new Set(['error']));
  });
});
