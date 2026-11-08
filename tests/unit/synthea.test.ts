import type { Bundle, Encounter, FhirResource } from 'fhir/r4';
import { describe, expect, it } from 'vitest';
import { validateResource } from '@/lib/fhir/validate';
import {
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

    expect(out.map((r) => `${r.resourceType}/${r.id}`)).toEqual(['Patient/pat-uuid-1', 'Encounter/enc-mid', 'Encounter/enc-new']);
    expect(stats.droppedEncounters).toBe(1);

    const enc = out.find((r) => r.id === 'enc-new') as Encounter;
    expect(enc.subject).toEqual({ reference: 'Patient/pat-uuid-1' });
    expect(enc.participant?.[0].individual).toEqual({ reference: 'Practitioner/prac-uuid-1', display: 'Dr. House' });
    expect(enc.serviceProvider).toEqual({ reference: 'Organization/org-uuid-1' });
    // Not imported -> logical references, no dangling links.
    expect(enc.location?.[0].location).toEqual({ identifier: { system: SYN, value: 'loc-1' }, display: 'General Clinic' });
    expect(enc.reasonReference?.[0]).toEqual({ display: 'Condition (not imported)' });

    for (const r of out) expect(validateResource(r)).toEqual([]);
    expect(stats.unresolvedReferences).toBe(4); // 2 kept encounters x (location + reasonReference)
    expect(stats.kept).toEqual({ Patient: 1, Encounter: 2 });
  });

  it('does not mutate the input bundle', () => {
    const index = indexProviderBundles([practitionerBundle, hospitalBundle]);
    const before = JSON.stringify(patientBundle);
    transformPatientBundle(patientBundle, index, 10, emptyStats());
    expect(JSON.stringify(patientBundle)).toBe(before);
  });
});
