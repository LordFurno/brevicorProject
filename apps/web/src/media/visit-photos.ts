import 'server-only';
import { adminClient } from '@/lib/supabase/admin';
import type { Visit } from '@/lib/visits/types';
export interface VisitPhoto {
  id: string;
  publicId: string;
  createdAt: string;
  notes: string;
  diagnosis?: string;
  updatedAt?: string;
  width?: number;
  height?: number;
  version?: number;
  source?: 'patient_upload' | 'in_call_capture';
  /** Set once filed to the chart ("Save to chart"). */
  documentRef?: string;
}
export interface HistoryPhoto extends VisitPhoto {
  visitId: string;
  meetingStart: string;
}
const g = globalThis as typeof globalThis & {
  memoryPhotos?: { visit: Visit; photo: VisitPhoto }[];
};
function memory() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Memory photos are development/test only');
  return (g.memoryPhotos ??= []);
}
const isMemory = () => process.env.VISIT_STORE === 'memory';
type PhotoRow = {
  id: string;
  cloudinary_public_id: string;
  created_at: string;
  notes: string;
  diagnosis?: string;
  updated_at?: string;
  width?: number;
  height?: number;
  version?: number;
  source?: 'patient_upload' | 'in_call_capture';
  document_ref?: string | null;
  visit_id: string;
  visits?: { start: string } | null;
};
const view = (p: PhotoRow): VisitPhoto => ({
  id: p.id,
  publicId: p.cloudinary_public_id,
  createdAt: p.created_at,
  notes: p.notes,
  diagnosis: p.diagnosis,
  updatedAt: p.updated_at,
  width: p.width,
  height: p.height,
  version: p.version,
  source: p.source,
  documentRef: p.document_ref ?? undefined,
});
export async function getPhotos(v: Visit): Promise<VisitPhoto[]> {
  if (isMemory())
    return structuredClone(
      memory()
        .filter(
          (e) =>
            e.visit.clinicId === v.clinicId &&
            e.visit.id === v.id &&
            e.visit.patientRef === v.patientRef,
        )
        .map((e) => e.photo),
    );
  const { data, error } = await adminClient()
    .from('visit_photos')
    .select('*')
    .eq('clinic_id', v.clinicId)
    .eq('visit_id', v.id)
    .eq('patient_ref', v.patientRef)
    .order('created_at', { ascending: false });
  if (error) throw new Error('Photo history unavailable');
  return (data ?? []).map(view);
}
export async function getHistory(v: Visit): Promise<HistoryPhoto[]> {
  if (isMemory())
    return structuredClone(
      memory()
        .filter((e) => e.visit.clinicId === v.clinicId && e.visit.patientRef === v.patientRef)
        .map((e) => ({ ...e.photo, visitId: e.visit.id, meetingStart: e.visit.start })),
    ).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const photos: HistoryPhoto[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await adminClient()
      .from('visit_photos')
      .select('*,visits!inner(start)')
      .eq('clinic_id', v.clinicId)
      .eq('patient_ref', v.patientRef)
      .order('created_at', { ascending: false })
      .order('id')
      .range(offset, offset + 999);
    if (error) throw new Error('Photo history unavailable');
    photos.push(
      ...(data ?? []).map((p) => ({
        ...view(p as PhotoRow),
        visitId: p.visit_id,
        meetingStart: (p.visits as unknown as { start: string }).start,
      })),
    );
    if ((data?.length ?? 0) < 1000) return photos;
  }
}
export async function addPhoto(
  v: Visit,
  photo: VisitPhoto,
  actor: 'patient' | 'physician' = 'patient',
) {
  if (isMemory()) {
    if (memory().filter((e) => e.visit.clinicId === v.clinicId && e.visit.id === v.id).length >= 30)
      throw new Error('Photo limit reached');
    memory().push({ visit: structuredClone(v), photo: structuredClone(photo) });
    return photo;
  }
  const { data, error } = await adminClient().rpc('memory_save_photo', {
    p_clinic: v.clinicId,
    p_visit: v.id,
    p_actor: actor,
    p_photo: {
      _patient_ref: v.patientRef,
      _practitioner_ref: v.practitionerRef,
      _invite_token_hash: v.inviteTokenHash,
      id: photo.id,
      cloudinary_public_id: photo.publicId,
      version: photo.version ?? null,
      width: photo.width ?? null,
      height: photo.height ?? null,
      source: photo.source ?? 'patient_upload',
      notes: photo.notes,
      diagnosis: photo.diagnosis ?? '',
    },
    p_update: false,
  });
  if (error) throw new Error('Photo could not be saved. Please retry.');
  return view(data as PhotoRow);
}
export async function updatePhoto(
  v: Visit,
  id: string,
  notes: string,
  diagnosis: string,
): Promise<VisitPhoto | null> {
  if (isMemory()) {
    const entry = memory().find(
      (e) =>
        e.visit.clinicId === v.clinicId &&
        e.visit.id === v.id &&
        e.visit.patientRef === v.patientRef &&
        e.photo.id === id,
    );
    if (!entry) return null;
    Object.assign(entry.photo, { notes, diagnosis, updatedAt: new Date().toISOString() });
    return structuredClone(entry.photo);
  }
  const { data, error } = await adminClient().rpc('memory_save_photo', {
    p_clinic: v.clinicId,
    p_visit: v.id,
    p_actor: 'physician',
    p_photo: {
      id,
      notes,
      diagnosis,
      _patient_ref: v.patientRef,
      _practitioner_ref: v.practitionerRef,
    },
    p_update: true,
  });
  if (error) throw new Error('Photo notes could not be saved');
  return data ? view(data as PhotoRow) : null;
}
/**
 * Records the DocumentReference a photo was filed as. Idempotent: an already
 * filed photo keeps its first reference (and no second event is written).
 */
export async function linkPhotoDocument(
  v: Visit,
  photoId: string,
  documentRef: string,
  syncStatus: 'ehr' | 'local-only',
): Promise<VisitPhoto | null> {
  if (isMemory()) {
    const entry = memory().find(
      (e) => e.visit.clinicId === v.clinicId && e.visit.id === v.id && e.visit.patientRef === v.patientRef && e.photo.id === photoId,
    );
    if (!entry) return null;
    entry.photo.documentRef ??= documentRef;
    return structuredClone(entry.photo);
  }
  const { data, error } = await adminClient().rpc('memory_link_photo_document', {
    p_clinic: v.clinicId,
    p_visit: v.id,
    p_photo: photoId,
    p_document_ref: documentRef,
    p_practitioner_ref: v.practitionerRef,
    p_sync: syncStatus,
  });
  if (error) throw new Error('Photo chart link could not be saved');
  return data ? view(data as PhotoRow) : null;
}
/** Where a photo lives, for the media route (which does its own authorization). */
export async function photoAsset(
  photoId: string,
): Promise<{ clinicId: string; patientRef: string; publicId: string; version?: number } | null> {
  if (isMemory()) {
    const e = memory().find((x) => x.photo.id === photoId);
    return e ? { clinicId: e.visit.clinicId, patientRef: e.visit.patientRef, publicId: e.photo.publicId, version: e.photo.version } : null;
  }
  const { data, error } = await adminClient()
    .from('visit_photos')
    .select('clinic_id,patient_ref,cloudinary_public_id,version')
    .eq('id', photoId)
    .maybeSingle();
  if (error) throw new Error('Photo unavailable');
  return data
    ? { clinicId: data.clinic_id, patientRef: data.patient_ref, publicId: data.cloudinary_public_id, version: data.version ?? undefined }
    : null;
}
