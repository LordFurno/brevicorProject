/**
 * Identifier systems shared by the gateway, importers and the app.
 *
 * Ontario health card number (HCN): the Canada Health Infoway NamingSystem
 * `ca-on-patient-hcn`, as used by the Ontario OLIS R4 and MI profiles. Infoway
 * lists the older eHealth Ontario URI as an alternate, so readers accept both.
 * The two-letter version code travels in the CA Baseline identifier-version
 * extension (as in the Ontario Patient Summary profile).
 */
export const ONTARIO_HCN_SYSTEM = 'https://fhir.infoway-inforoute.ca/NamingSystem/ca-on-patient-hcn';
export const ONTARIO_HCN_LEGACY_SYSTEMS = [
  'http://ehealthontario.ca/API/FHIR/NamingSystem/ca-on-patient-hcn',
  'https://ehealthontario.ca/API/FHIR/NamingSystem/ca-on-patient-hcn',
];
export const IDENTIFIER_VERSION_EXT = 'http://hl7.org/fhir/ca/baseline/StructureDefinition/ext-identifierversion';

/** Identifies the Encounter Brevicor opens for an appointment (value = the Appointment id). */
export const APPOINTMENT_ENCOUNTER_SYSTEM = 'https://brevicor.ca/fhir/sid/appointment-encounter';

/** meta.tag on resources the Brevicor docstore holds because the clinic's EHR can't. */
export const SYNC_STATUS_SYSTEM = 'https://brevicor.ca/fhir/sync-status';
export const LOCAL_ONLY_TAG = { system: SYNC_STATUS_SYSTEM, code: 'local-only', display: 'Stored by Brevicor only (not in the EHR)' };
