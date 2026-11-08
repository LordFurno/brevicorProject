import type * as fhir4 from 'fhir/r4';
import { gatewayRead, gatewaySearch, type GatewayContext } from './gateway';
import { mapChart } from './map';
import type { ChartSection, ClinicalDataSource, SectionState } from './types';

type Capability = { searchable: (type: string) => boolean; hasParam: (type: string, param: string) => boolean };

/** What the clinic's EHR offers, from the gateway's CapabilityStatement. */
export function capabilityOf(statement: fhir4.CapabilityStatement): Capability {
  const resources = statement.rest?.find((r) => r.mode === 'server')?.resource ?? statement.rest?.[0]?.resource ?? [];
  const find = (type: string) => resources.find((r) => r.type === type);
  return {
    searchable: (type) => !!find(type)?.interaction?.some((i) => i.code === 'search-type'),
    hasParam: (type, param) => !!find(type)?.searchParam?.some((p) => p.name === param),
  };
}

interface Section<T> {
  state: SectionState;
  items: T[];
}

/**
 * Reads a patient's chart through the gateway. Types the clinic doesn't offer
 * are reported per section as `unavailable` (never queried); failed queries
 * are `error`. Neither is ever shown as "none recorded".
 */
export const fhirSource: ClinicalDataSource = {
  async getChart(lookup) {
    if (!lookup.patientRef) throw new Error('Patient reference is required');
    const ctx: GatewayContext = { clinicId: lookup.clinicId, accessToken: lookup.accessToken };
    const [patient, statement] = await Promise.all([
      gatewayRead<fhir4.Patient>(lookup.patientRef, ctx),
      gatewayRead<fhir4.CapabilityStatement>('metadata', ctx),
    ]);
    const caps = capabilityOf(statement);
    const ref = encodeURIComponent(lookup.patientRef);

    /** Adds a filter only where the clinic supports that param; the chart filters again anyway. */
    const query = (type: string, filters: [string, string][] = []) =>
      [`${type}?patient=${ref}`, ...filters.filter(([p]) => caps.hasParam(type, p)).map(([p, v]) => `${p}=${encodeURIComponent(v)}`), '_count=100'].join('&');

    const section = async <T extends fhir4.FhirResource>(type: string, filters?: [string, string][]): Promise<Section<T>> => {
      if (!caps.searchable(type)) return { state: 'unavailable', items: [] };
      try {
        return { state: 'ok', items: await gatewaySearch<T>(query(type, filters), ctx) };
      } catch (e) {
        // No PHI: the error carries only an HTTP status.
        console.error(`[clinical] ${type} search failed:`, e instanceof Error ? e.message : 'unknown error');
        return { state: 'error', items: [] };
      }
    };

    const [conditions, allergies, medications, observations, encounters, documents] = await Promise.all([
      section<fhir4.Condition>('Condition', [['clinical-status', 'active']]),
      section<fhir4.AllergyIntolerance>('AllergyIntolerance'),
      section<fhir4.MedicationRequest>('MedicationRequest', [['status', 'active']]),
      section<fhir4.Observation>('Observation', [['category', 'vital-signs,laboratory']]),
      section<fhir4.Encounter>('Encounter'),
      // Only adds visit summaries; past visits still show without it.
      section<fhir4.DocumentReference>('DocumentReference'),
    ]);

    const sections: Record<ChartSection, SectionState> = {
      conditions: conditions.state,
      allergies: allergies.state,
      medications: medications.state,
      vitals: observations.state,
      labs: observations.state,
      visits: encounters.state,
    };
    return mapChart(
      {
        patient,
        conditions: conditions.items,
        allergies: allergies.items,
        medications: medications.items,
        observations: observations.items,
        encounters: encounters.items,
        documents: documents.items,
      },
      { matched: true, source: 'fhir', sections },
    );
  },
};
