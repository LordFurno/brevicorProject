import type { Appointment } from 'fhir/r4';

/** How the app tells video from telephone consultations: Appointment.serviceType. Documented in docs/fhir-contract.md. */
export const MODALITY_SYSTEM = 'https://brevicor.ca/fhir/CodeSystem/consultation-modality';

export type Modality = 'video' | 'telephone';

/** The appointment's consultation modality, or null when the EHR didn't record one. */
export function appointmentModality(appointment: Appointment): Modality | null {
  for (const concept of appointment.serviceType ?? []) {
    for (const coding of concept.coding ?? []) {
      if (coding.system === MODALITY_SYSTEM && (coding.code === 'video' || coding.code === 'telephone')) return coding.code;
    }
  }
  return null;
}
