import 'server-only';
import { createHash } from 'node:crypto';
import type { Visit } from '@/lib/visits/types';

export interface VisitPhoto { width?: number; height?: number; version?: number; id: string; publicId: string; createdAt: string; notes: string; diagnosis?: string; updatedAt?: string }
interface Context { clinicId: string; practitionerId: string; patientKey: string; meetingStart: string }
interface Entry { context?: Context; photos: VisitPhoto[] }
export interface HistoryPhoto extends VisitPhoto { visitId: string; meetingStart: string }
type Data = Record<string, Entry>;
const memory = globalThis as typeof globalThis & { photoHistoryData?: Data };
// Temporary adapter for the photo UI. Replace read/save with the shared backend
// when durable patient history is connected. Nothing here writes patient records.
function read(): Data { return memory.photoHistoryData ??= {}; }
function save(data: Data) { memory.photoHistoryData = data; }
export function photoContext(visit: Visit): Context | undefined {
  if (!visit.patient || !visit.clinicId || !visit.practitionerId) return undefined;
  // The visit model has no stable patient ID. Match exact normalized name + DOB
  // within this clinic and physician; do not expose those identifiers in media URLs.
  const patientKey = createHash('sha256').update(JSON.stringify([visit.patient.name.trim().toLowerCase().replace(/\s+/g, ' '), visit.patient.dateOfBirth])).digest('hex');
  return { clinicId: visit.clinicId, practitionerId: visit.practitionerId, patientKey, meetingStart: visit.start };
}
export function getPhotos(id: string): VisitPhoto[] { return read()[id]?.photos ?? []; }
export function addPhoto(id: string, photo: VisitPhoto, context?: Context) {
  const data = read(), entry = data[id] ?? { photos: [] };
  if (entry.photos.length >= 30) throw new Error('Photo limit reached for this visit.');
  data[id] = { context: context ?? entry.context, photos: [photo, ...entry.photos] }; save(data);
}
export function updatePhoto(visitId: string, photoId: string, notes: string, diagnosis: string): VisitPhoto | null {
  const data = read(), entry = data[visitId];
  const photo = entry?.photos.find((p) => p.id === photoId);
  if (!photo) return null;
  photo.notes = notes; photo.diagnosis = diagnosis; photo.updatedAt = new Date().toISOString(); save(data); return photo;
}
export function getHistory(visit: Visit): HistoryPhoto[] {
  const data = read(), context = photoContext(visit);
  return Object.entries(data).filter(([id, entry]) => id === visit.id || (context && entry.context && entry.context.clinicId === context.clinicId && entry.context.practitionerId === context.practitionerId && entry.context.patientKey === context.patientKey))
    .flatMap(([visitId, entry]) => entry.photos.map((photo) => ({ ...photo, visitId, meetingStart: entry.context?.meetingStart ?? photo.createdAt })))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
