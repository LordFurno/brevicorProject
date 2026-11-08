// UI-friendly chart summary built from FHIR R4 resources (client-safe).

export interface ChartSummary {
  matched: boolean;
  source: 'mock' | 'fhir';
  error?: string;
  patient: {
    id?: string;
    name: string;
    birthDate?: string;
    sex?: string;
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

export interface PatientLookup { patientRef?: string; accessToken?: string;
  clinicId: string;
  name: string;
  dateOfBirth: string;
  healthCardNumber?: string;
}

export interface ClinicalDataSource {
  getChart(lookup: PatientLookup): Promise<ChartSummary>;
}
