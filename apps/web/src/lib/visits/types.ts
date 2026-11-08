// Persistent activity only. Display data is hydrated from FHIR per request.
export type VisitStatus = 'scheduled' | 'waiting' | 'in_progress' | 'completed' | 'cancelled';
export interface Visit {
  id: string;
  clinicId: string;
  appointmentRef: string;
  patientRef: string;
  practitionerRef: string;
  encounterRef?: string;
  modality: 'video' | 'phone';
  start: string;
  end: string;
  status: VisitStatus;
  appointmentStatus: string;
  inviteTokenHash: string;
  roomName: string;
  waitingSince?: string;
  lastSeenAt?: string;
  admittedAt?: string;
  endedAt?: string;
  verifyAttempts: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface DoctorVisitView {
  id: string;
  start: string;
  end: string;
  status: VisitStatus;
  modality: 'video' | 'phone';
  present: boolean;
  waitingSince?: string;
  admittedAt?: string;
  endedAt?: string;
  patientName: string;
  patientDateOfBirth: string;
  reason: string;
}
export type EventType =
  | 'synced'
  | 'invited'
  | 'rescheduled'
  | 'cancelled'
  | 'verify_failed'
  | 'verified'
  | 'checked_in'
  | 'admitted'
  | 'ended'
  | 'photo_added'
  | 'photo_updated'
  | 'notification_sent'
  | 'notification_failed'
  | 'notification_skipped';
export interface VisitEvent {
  type: EventType;
  actor: 'patient' | 'physician' | 'system';
  meta?: Record<string, string>;
}
export type PatientPhase = 'too_early' | 'waiting' | 'in_call' | 'ended' | 'cancelled' | 'expired';
export interface PatientStatus {
  phase: PatientPhase;
  startsAt: string;
  canEnterAt: string;
  waitingSince?: string;
  queuePosition?: number;
  doctorBusy: boolean;
  minutesLate: number;
}
export const EARLY_ENTRY_MIN = 15;
export const LATE_ENTRY_MIN = 30;
export const PRESENCE_TIMEOUT_MS = 20_000;
export const MAX_VERIFY_ATTEMPTS = 5;
export const BOOKING_LEAD_MIN = 30;
export const BOOKING_HORIZON_DAYS = 60;
