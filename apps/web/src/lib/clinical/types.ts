// UI-friendly chart summary built from FHIR R4 resources (client-safe).

/** Chart sections that come from separate FHIR resource types. */
export type ChartSection = 'allergies' | 'conditions' | 'medications' | 'vitals' | 'labs' | 'visits';

/**
 * ok: loaded (possibly empty). unavailable: the clinic's EHR doesn't offer this
 * resource type (per its CapabilityStatement). error: the request failed.
 * Never show "none recorded" unless the state is ok.
 */
export type SectionState = 'ok' | 'unavailable' | 'error';

export interface ChartSummary {
  matched: boolean;
  source: 'mock' | 'fhir';
  error?: string;
  sections: Record<ChartSection, SectionState>;
  patient: {
    id?: string;
    name: string;
    birthDate?: string;
    sex?: string;
    /** Ontario health card number, formatted "1234 567 890 AB". */
    healthCard?: string;
    phone?: string;
    email?: string;
    address?: string;
    language?: string;
  };
  allergies: { substance: string; reaction?: string; severity?: string; critical: boolean }[];
  conditions: { name: string; onset?: string; status?: string }[];
  medications: { name: string; dosage?: string; status?: string }[];
  vitals: { label: string; value: string; unit?: string; date?: string }[];
  labs: { label: string; value: string; unit?: string; flag?: string; date?: string }[];
  visits: { id?: string; date?: string; type?: string; practitioner?: string; reason?: string; summary?: string }[];
}

export const ALL_SECTIONS_OK: Record<ChartSection, SectionState> = {
  allergies: 'ok',
  conditions: 'ok',
  medications: 'ok',
  vitals: 'ok',
  labs: 'ok',
  visits: 'ok',
};

export interface PatientLookup { patientRef?: string; accessToken?: string;
  clinicId: string;
  name: string;
  dateOfBirth: string;
  healthCardNumber?: string;
}

export interface ClinicalDataSource {
  getChart(lookup: PatientLookup): Promise<ChartSummary>;
}
