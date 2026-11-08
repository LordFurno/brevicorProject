import { fhirSource } from './fhir-source';
import { mockSource } from './mock-source';
import type { ChartSummary, ClinicalDataSource, PatientLookup } from './types';

/** CLINICAL_SOURCE=mock (default) | fhir */
export function getClinicalSource(): ClinicalDataSource {
  return process.env.CLINICAL_SOURCE === 'fhir' ? fhirSource : mockSource;
}

/** Never throws: a records outage must not block the consultation. */
export async function loadChart(lookup: PatientLookup): Promise<ChartSummary> {
  try {
    return await getClinicalSource().getChart(lookup);
  } catch (e) {
    // No PHI in logs — message only.
    console.error('[clinical] chart lookup failed:', e instanceof Error ? e.message : 'unknown error');
    return {
      matched: false,
      source: process.env.CLINICAL_SOURCE === 'fhir' ? 'fhir' : 'mock',
      error: 'Clinic records are temporarily unavailable. You can continue the visit.',
      patient: { name: lookup.name, birthDate: lookup.dateOfBirth },
      allergies: [], conditions: [], medications: [], vitals: [], labs: [], visits: [],
    };
  }
}
