import 'server-only';
import type { DocumentReference, Encounter, FhirResource } from 'fhir/r4';
import type { Visit } from '@/lib/visits/types';
import { gatewayCreate, type GatewayContext } from './gateway';

/**
 * Clinical write-back, always through the FHIR gateway. The gateway decides
 * where a write lands: the clinic's EHR, or Brevicor's docstore (tagged
 * local-only) when the EHR can't take it.
 */

export const APPOINTMENT_ENCOUNTER_SYSTEM = 'https://brevicor.ca/fhir/sid/appointment-encounter';
const SYNC_STATUS_SYSTEM = 'https://brevicor.ca/fhir/sync-status';
const ACT_CODE = 'http://terminology.hl7.org/CodeSystem/v3-ActCode';

export type SyncStatus = 'ehr' | 'local-only';

export function syncStatusOf(resource: FhirResource): SyncStatus {
  return resource.meta?.tag?.some((t) => t.system === SYNC_STATUS_SYSTEM && t.code === 'local-only') ? 'local-only' : 'ehr';
}

/** FHIR instant without milliseconds. */
const instant = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** The Encounter Brevicor opens when the physician admits the patient. Never completed by Brevicor. */
export function visitEncounter(v: Visit, now = Date.now()): Encounter {
  return {
    resourceType: 'Encounter',
    identifier: [{ system: APPOINTMENT_ENCOUNTER_SYSTEM, value: v.appointmentRef.slice('Appointment/'.length) }],
    status: 'in-progress',
    class: { system: ACT_CODE, code: 'VR', display: 'virtual' },
    type: [{ text: v.modality === 'video' ? 'Video consultation' : 'Telephone consultation' }],
    subject: { reference: v.patientRef },
    participant: [{ individual: { reference: v.practitionerRef } }],
    appointment: [{ reference: v.appointmentRef }],
    period: { start: instant(v.admittedAt ? Date.parse(v.admittedAt) : now) },
  };
}

export interface LinkedEncounter {
  ref: string;
  result: 'created' | 'existing';
  syncStatus: SyncStatus;
}

/**
 * Conditional create keyed by the appointment (every clinic can search
 * Encounter by appointment), so retries and second admits reuse it.
 */
export async function ensureEncounter(v: Visit, ctx: GatewayContext, now = Date.now()): Promise<LinkedEncounter> {
  const { resource, created } = await gatewayCreate(visitEncounter(v, now), ctx, {
    ifNoneExist: `appointment=${encodeURIComponent(v.appointmentRef)}`,
  });
  return { ref: `Encounter/${resource.id}`, result: created ? 'created' : 'existing', syncStatus: syncStatusOf(resource) };
}

export interface ChartPhoto {
  id: string;
  createdAt: string;
  notes: string;
  diagnosis?: string;
}

/** A consultation photo filed to the chart. The image stays in Brevicor's media store; `url` points at it. */
export function photoDocument(v: Visit, photo: ChartPhoto, imageUrl: string, now = Date.now()): DocumentReference {
  const diagnosis = photo.diagnosis?.trim();
  const notes = photo.notes.trim();
  const description = [diagnosis && `Diagnosis/assessment: ${diagnosis}`, notes && `Notes: ${notes}`].filter(Boolean).join('\n');
  return {
    resourceType: 'DocumentReference',
    status: 'current',
    docStatus: 'final',
    type: { coding: [{ system: 'http://loinc.org', code: '72170-4', display: 'Photographic image' }], text: 'Clinical photograph' },
    subject: { reference: v.patientRef },
    date: instant(now),
    author: [{ reference: v.practitionerRef }],
    ...(description ? { description } : {}),
    content: [
      {
        attachment: {
          contentType: 'image/jpeg',
          url: imageUrl,
          title: diagnosis ? `Clinical photo – ${diagnosis}`.slice(0, 200) : 'Clinical photo',
          creation: photo.createdAt,
        },
      },
    ],
    ...(v.encounterRef ? { context: { encounter: [{ reference: v.encounterRef }] } } : {}),
  };
}

export async function createPhotoDocument(v: Visit, photo: ChartPhoto, imageUrl: string, ctx: GatewayContext) {
  const { resource } = await gatewayCreate(photoDocument(v, photo, imageUrl), ctx);
  return { ref: `DocumentReference/${resource.id}`, syncStatus: syncStatusOf(resource) };
}
