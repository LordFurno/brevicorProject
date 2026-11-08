import { fhirSource } from './fhir-source';
import { mockSource } from './mock-source';
import { bookingEnabled } from '@/lib/booking';
import type { ChartSummary, ClinicalDataSource, PatientLookup } from './types';

/** FHIR by default; the isolated development booking preview may use mock. */
export function getClinicalSource(): ClinicalDataSource {
  return bookingEnabled() && process.env.CLINICAL_SOURCE === 'mock' ? mockSource : fhirSource;
}

/** Never throws: a records outage must not block the consultation. */
export async function loadChart(lookup: PatientLookup): Promise<ChartSummary> {
  const source = lookup.patientRef ? fhirSource : getClinicalSource();
  try {
    return await source.getChart(lookup);
  } catch (e) {
    // No PHI in logs — message only.
    console.error('[clinical] chart lookup failed:', e instanceof Error ? e.message : 'unknown error');
    return {
      matched: false,
      source: source === fhirSource ? 'fhir' : 'mock',
      error: 'Clinic records are temporarily unavailable. You can continue the visit.',
      patient: { name: lookup.name, birthDate: lookup.dateOfBirth },
      allergies: [], conditions: [], medications: [], vitals: [], labs: [], visits: [],
    };
  }
}
