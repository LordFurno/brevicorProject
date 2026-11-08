import type { Bundle, Encounter, FhirResource, MedicationRequest, Observation, Patient } from 'fhir/r4';
import { describe, expect, it } from 'vitest';
import { validateResource } from '@/lib/fhir/validate';
import { ONTARIO_HCN_SYSTEM } from '@/lib/fhir/identifiers';
import { hcnCheckDigit, passesHcnCheckDigit, syntheticHcn } from '@/scripts/lib/hcn';
import {
  defaultCaps,
  emptyStats,
  indexProviderBundles,
  isProviderFile,
  transformPatientBundle,
  transformProviderResources,
} from '@/scripts/lib/synthea';

// Hand-written in the shape Synthea emits (not real Synthea output).
const NPI = 'http://hl7.org/fhir/sid/us-npi';
const SYN = 'https://github.com/synthetichealth/synthea';

const practitionerBundle: Bundle<FhirResource> = {
  resourceType: 'Bundle',
  type: 'batch',
  entry: [
    {
      fullUrl: 'urn:uuid:prac-uuid-1',
      resource: { resourceType: 'Practitioner', id: 'prac-uuid-1', identifier: [{ system: NPI, value: '9999000001' }], name: [{ family: 'House' }] },
    },
    { fullUrl: 'urn:uuid:role-1', resource: { resourceType: 'PractitionerRole', id: 'role-1' } },
  ],
};

const hospitalBundle: Bundle<FhirResource> = {
  resourceType: 'Bundle',
  type: 'batch',
  entry: [
    { fullUrl: 'urn:uuid:org-uuid-1', resource: { resourceType: 'Organization', id: 'org-uuid-1', identifier: [{ system: SYN, value: 'org-uuid-1' }], name: 'General' } },
    { fullUrl: 'urn:uuid:loc-1', resource: { resourceType: 'Location', id: 'loc-1', identifier: [{ system: SYN, value: 'loc-1' }] } },
  ],
};

function encounter(id: string, start: string): Encounter {
  return {
    resourceType: 'Encounter',
    id,
    status: 'finished',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
    subject: { reference: 'urn:uuid:pat-uuid-1' },
    participant: [{ individual: { reference: `Practitioner?identifier=${NPI}|9999000001`, display: 'Dr. House' } }],
    location: [{ location: { reference: `Location?identifier=${SYN}|loc-1`, display: 'General Clinic' } }],
    serviceProvider: { reference: `Organization?identifier=${SYN}|org-uuid-1` },
    reasonReference: [{ reference: 'urn:uuid:cond-1' }],
    period: { start, end: start },
  };
}

const patientBundle: Bundle<FhirResource> = {
  resourceType: 'Bundle',
  type: 'transaction',
  entry: [
    { fullUrl: 'urn:uuid:pat-uuid-1', resource: { resourceType: 'Patient', id: 'pat-uuid-1', name: [{ family: 'Abbott774' }], birthDate: '1970-01-01' } },
    { fullUrl: 'urn:uuid:enc-old', resource: encounter('enc-old', '2001-01-01T10:00:00-05:00') },
    { fullUrl: 'urn:uuid:enc-mid', resource: encounter('enc-mid', '2015-01-01T10:00:00-05:00') },
    { fullUrl: 'urn:uuid:enc-new', resource: encounter('enc-new', '2025-01-01T10:00:00-05:00') },
    { fullUrl: 'urn:uuid:cond-1', resource: { resourceType: 'Condition', id: 'cond-1', subject: { reference: 'urn:uuid:pat-uuid-1' } } as FhirResource },
  ],
};

describe('Synthea transform', () => {
  it('recognises provider files', () => {
    expect(isProviderFile('practitionerInformation1700000000000.json')).toBe(true);
    expect(isProviderFile('hospitalInformation1700000000000.json')).toBe(true);
    expect(isProviderFile('Ada_Lovelace_1234.json')).toBe(false);
  });

  it('keeps only Practitioner/Organization from provider bundles', () => {
    const index = indexProviderBundles([practitionerBundle, hospitalBundle]);
    const stats = emptyStats();
    const out = transformProviderResources(index, stats);
    expect(out.map((r) => `${r.resourceType}/${r.id}`).sort()).toEqual(['Organization/org-uuid-1', 'Practitioner/prac-uuid-1']);
  });

  it('resolves urn:uuid and conditional references, caps encounters, and stays valid R4', () => {
    const index = indexProviderBundles([practitionerBundle, hospitalBundle]);
    const stats = emptyStats();
    const out = transformPatientBundle(patientBundle, index, 2, stats);

    expect(out.map((r) => `${r.resourceType}/${r.id}`)).toEqual(['Patient/pat-uuid-1', 'Encounter/enc-mid', 'Encounter/enc-new', 'Condition/cond-1']);
    expect(stats.droppedEncounters).toBe(1);

    const enc = out.find((r) => r.id === 'enc-new') as Encounter;
    expect(enc.subject).toEqual({ reference: 'Patient/pat-uuid-1' });
    expect(enc.participant?.[0].individual).toEqual({ reference: 'Practitioner/prac-uuid-1', display: 'Dr. House' });
    expect(enc.serviceProvider).toEqual({ reference: 'Organization/org-uuid-1' });
    // Not imported -> logical references, no dangling links.
    expect(enc.location?.[0].location).toEqual({ identifier: { system: SYN, value: 'loc-1' }, display: 'General Clinic' });
    expect(enc.reasonReference?.[0]).toEqual({ reference: 'Condition/cond-1' }); // Conditions are kept now

    for (const r of out) expect(validateResource(r)).toEqual([]);
    expect(stats.unresolvedReferences).toBe(2); // 2 kept encounters x location
    expect(stats.kept).toEqual({ Patient: 1, Encounter: 2, Condition: 1 });
  });

  it('does not mutate the input bundle', () => {
    const index = indexProviderBundles([practitionerBundle, hospitalBundle]);
    const before = JSON.stringify(patientBundle);
    transformPatientBundle(patientBundle, index, 10, emptyStats());
    expect(JSON.stringify(patientBundle)).toBe(before);
  });

  it('adds a synthetic Ontario HCN that fails the check digit', () => {
    const index = indexProviderBundles([practitionerBundle, hospitalBundle]);
    const [patient] = transformPatientBundle(patientBundle, index, 10, emptyStats()) as Patient[];
    const hcn = patient.identifier?.find((i) => i.system === ONTARIO_HCN_SYSTEM);
    expect(hcn?.value).toMatch(/^\d{10}$/);
    expect(hcn?.type?.coding?.[0].code).toBe('JHN');
    expect(hcn?.extension?.[0].valueString).toMatch(/^[A-Z]{2}$/);
    expect(passesHcnCheckDigit(hcn!.value!)).toBe(false);
    expect(hcn?.value).toBe(syntheticHcn('pat-uuid-1').number); // same number ClinicSoft gets
  });

  it('applies the clinical caps and inlines Medication', () => {
    const now = new Date('2026-11-08T12:00:00Z');
    const subject = { reference: 'urn:uuid:pat-uuid-1' };
    const vital = { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] };
    const survey = { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'survey' }] };
    const hr = (id: string, at: string): Observation => ({
      resourceType: 'Observation', id, status: 'final', category: [vital], subject, effectiveDateTime: at,
      code: { coding: [{ system: 'http://loinc.org', code: '8867-4' }] }, valueQuantity: { value: 70 },
    });
    const med = (id: string, authoredOn: string, extra: Partial<MedicationRequest> = {}): MedicationRequest => ({
      resourceType: 'MedicationRequest', id, status: 'active', intent: 'order', subject, authoredOn,
      medicationCodeableConcept: { text: 'x' }, ...extra,
    });
    const bundle: Bundle<FhirResource> = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        { fullUrl: 'urn:uuid:pat-uuid-1', resource: { resourceType: 'Patient', id: 'pat-uuid-1' } },
        ...['2020', '2021', '2022', '2023'].map((y) => ({ resource: hr(`hr-${y}`, `${y}-01-01T10:00:00Z`) })),
        { resource: { ...hr('phq', '2025-01-01T10:00:00Z'), category: [survey] } },
        { fullUrl: 'urn:uuid:med-def', resource: { resourceType: 'Medication', id: 'med-def', code: { text: 'Amoxicillin 250 MG' } } },
        { resource: med('rx-old', '2024-11-07T12:00:00Z') },
        { resource: med('rx-new', '2025-01-01T12:00:00Z', { medicationCodeableConcept: undefined, medicationReference: { reference: 'urn:uuid:med-def' } }) },
      ],
    };
    const stats = emptyStats();
    const out = transformPatientBundle(bundle, indexProviderBundles([]), 10, stats, defaultCaps(now));
    const ids = out.map((r) => r.id).sort();
    expect(ids).toEqual(['hr-2021', 'hr-2022', 'hr-2023', 'pat-uuid-1', 'rx-new']);
    expect(stats.droppedByCap).toEqual({ Observation: 2, MedicationRequest: 1 });
    const rx = out.find((r) => r.id === 'rx-new') as MedicationRequest;
    expect(rx.medicationReference).toBeUndefined();
    expect(rx.medicationCodeableConcept).toEqual({ text: 'Amoxicillin 250 MG' });
    for (const r of out) expect(validateResource(r)).toEqual([]);
  });
});

describe('synthetic Ontario health card numbers', () => {
  it('computes the Luhn check digit the Ontario way', () => {
    // 1st, 3rd, 5th, 7th and 9th digits doubled: 234567890 -> check digit 4.
    expect(hcnCheckDigit('234567890')).toBe(4);
    expect(passesHcnCheckDigit('2345678904')).toBe(true);
    expect(passesHcnCheckDigit('2345678905')).toBe(false);
  });

  it('never generates a number that passes the check digit', () => {
    for (let i = 0; i < 5000; i++) {
      const { number, version } = syntheticHcn(`patient-${i}`);
      expect(number).toMatch(/^[1-9]\d{9}$/);
      expect(version).toMatch(/^[A-Z]{2}$/);
      expect(passesHcnCheckDigit(number)).toBe(false);
    }
  });

  it('is deterministic per patient', () => {
    expect(syntheticHcn('abc')).toEqual(syntheticHcn('abc'));
    expect(syntheticHcn('abc')).not.toEqual(syntheticHcn('abd'));
  });
});
