import { mapChart, type ClinicalResource } from './map';
import type { ClinicalDataSource, PatientLookup } from './types';

// Reads the chart from the team's FHIR R4 gateway (/api/fhir/R4).
// Auth: Bearer FHIR_API_KEY. The gateway derives the tenant from the key —
// we never send a tenant header (see root CLAUDE.md).

function cfg() {
  const base = process.env.FHIR_BASE_URL?.replace(/\/$/, '');
  if (!base) throw new Error('FHIR_BASE_URL is not set');
  return { base, key: process.env.FHIR_API_KEY };
}

async function search<T extends ClinicalResource>(query: string): Promise<T[]> {
  const { base, key } = cfg();
  const res = await fetch(`${base}/${query}`, {
    headers: { Accept: 'application/fhir+json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    cache: 'no-store',
  });
  // Never put the URL in the error — it contains identifiers.
  if (!res.ok) throw new Error(`FHIR search failed (${res.status})`);
  // Parse loosely: we only need entry[].resource, and the gateway validates FHIR on its side.
  const bundle = (await res.json()) as { entry?: { resource?: unknown }[] };
  return (bundle.entry ?? []).map((e) => e.resource).filter((r): r is T => !!r);
}

/** A failed secondary search shouldn't blank the whole chart. */
async function safe<T extends ClinicalResource>(query: string) {
  try {
    return await search<T>(query);
  } catch {
    return [];
  }
}

export const fhirSource: ClinicalDataSource = {
  async getChart(lookup: PatientLookup) {
    const q = encodeURIComponent;
    const parts = lookup.name.trim().split(/\s+/);
    const family = parts[parts.length - 1];

    let patients: fhir4.Patient[] = [];
    if (lookup.healthCardNumber) patients = await search<fhir4.Patient>(`Patient?identifier=${q(lookup.healthCardNumber)}`);
    if (!patients.length)
      patients = await search<fhir4.Patient>(`Patient?family=${q(family)}&birthdate=${q(lookup.dateOfBirth)}`);

    const patient = patients[0];
    if (!patient?.id) {
      return mapChart(
        {
          patient: { resourceType: 'Patient', birthDate: lookup.dateOfBirth, name: [{ text: lookup.name }] },
          conditions: [], allergies: [], medications: [], observations: [], encounters: [], documents: [],
        },
        { matched: false, source: 'fhir' },
      );
    }

    const ref = q(`Patient/${patient.id}`);
    const [conditions, allergies, medications, observations, encounters, documents] = await Promise.all([
      safe<fhir4.Condition>(`Condition?patient=${ref}`),
      safe<fhir4.AllergyIntolerance>(`AllergyIntolerance?patient=${ref}`),
      safe<fhir4.MedicationStatement>(`MedicationStatement?patient=${ref}`),
      safe<fhir4.Observation>(`Observation?patient=${ref}&_sort=-date&_count=50`),
      safe<fhir4.Encounter>(`Encounter?patient=${ref}&_sort=-date&_count=10`),
      safe<fhir4.DocumentReference>(`DocumentReference?patient=${ref}&_count=20`),
    ]);

    return mapChart(
      { patient, conditions, allergies, medications, observations, encounters, documents },
      { matched: true, source: 'fhir' },
    );
  },
};
