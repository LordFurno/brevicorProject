import type * as fhir4 from 'fhir/r4';
import { mapChart, type ClinicalResource, type FhirChartBundle } from './map';
import { mockResources, samplePatientResources } from './mock-data';
import type { ClinicalDataSource, PatientLookup } from './types';

const digits = (s?: string) => (s ?? '').replace(/\D/g, '').slice(0, 10);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

function bundleFor(resources: ClinicalResource[], patient: fhir4.Patient): FhirChartBundle {
  const ref = `Patient/${patient.id}`;
  const of = <T extends ClinicalResource>(type: T['resourceType'], pick: (r: T) => string | undefined) =>
    resources.filter((r): r is T => r.resourceType === type && pick(r as T) === ref);
  return {
    patient,
    conditions: of<fhir4.Condition>('Condition', (r) => r.subject.reference),
    allergies: of<fhir4.AllergyIntolerance>('AllergyIntolerance', (r) => r.patient.reference),
    medications: of<fhir4.MedicationStatement>('MedicationStatement', (r) => r.subject.reference),
    observations: of<fhir4.Observation>('Observation', (r) => r.subject?.reference),
    encounters: of<fhir4.Encounter>('Encounter', (r) => r.subject?.reference),
    documents: of<fhir4.DocumentReference>('DocumentReference', (r) => r.subject?.reference),
  };
}

export const mockSource: ClinicalDataSource = {
  async getChart(lookup: PatientLookup) {
    const patients = mockResources.filter((r): r is fhir4.Patient => r.resourceType === 'Patient');
    const hcn = digits(lookup.healthCardNumber);
    const match =
      (hcn && patients.find((p) => p.identifier?.some((i) => digits(i.value) === hcn))) ||
      patients.find((p) => {
        const n = p.name?.[0];
        return p.birthDate === lookup.dateOfBirth && norm(`${n?.given?.join('') ?? ''}${n?.family ?? ''}`) === norm(lookup.name);
      });

    if (match) return mapChart(bundleFor(mockResources, match), { matched: true, source: 'mock' });

    const sample = samplePatientResources(lookup.name, lookup.dateOfBirth);
    return mapChart(bundleFor(sample, sample[0] as fhir4.Patient), { matched: false, source: 'mock' });
  },
};
