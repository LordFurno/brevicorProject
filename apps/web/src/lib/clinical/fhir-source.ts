import type * as fhir4 from 'fhir/r4';
import { gatewayRead, gatewaySearch } from './gateway';
import { mapChart } from './map';
import type { ClinicalDataSource } from './types';
export const fhirSource: ClinicalDataSource = {
  async getChart(lookup) {
    if (!lookup.patientRef) throw new Error('Patient reference is required');
    const ctx = { clinicId: lookup.clinicId, accessToken: lookup.accessToken };
    const patient = await gatewayRead<fhir4.Patient>(lookup.patientRef, ctx),
      ref = encodeURIComponent(lookup.patientRef);
    const safe = <T extends fhir4.FhirResource>(type: string) =>
      gatewaySearch<T>(`${type}?patient=${ref}&_count=100`, ctx).catch(() => [] as T[]);
    const [conditions, allergies, medications, observations, encounters, documents] =
      await Promise.all([
        safe<fhir4.Condition>('Condition'),
        safe<fhir4.AllergyIntolerance>('AllergyIntolerance'),
        safe<fhir4.MedicationStatement>('MedicationStatement'),
        safe<fhir4.Observation>('Observation'),
        safe<fhir4.Encounter>('Encounter'),
        safe<fhir4.DocumentReference>('DocumentReference'),
      ]);
    return mapChart(
      { patient, conditions, allergies, medications, observations, encounters, documents },
      { matched: true, source: 'fhir' },
    );
  },
};
