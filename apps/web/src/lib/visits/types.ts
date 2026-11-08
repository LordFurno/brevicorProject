// Shared visit types (safe to import from client components).

export type VisitStatus = 'scheduled' | 'waiting' | 'in_progress' | 'completed' | 'cancelled';

export interface VisitPatient {
  name: string;
  dateOfBirth: string; // YYYY-MM-DD
  healthCardNumber?: string;
  email?: string;
  phone?: string;
}

export interface Visit {
  id: string;
  clinicId: string; // tenant
  practitionerId: string;
  start: string; // ISO
  end: string; // ISO
  reason: string;
  patient: VisitPatient;
  inviteToken: string;
  roomName: string;
  status: VisitStatus;
  createdAt: string;
  waitingSince?: string;
  lastSeenAt?: string;
  admittedAt?: string;
  endedAt?: string;
  verifyAttempts: number;
  /** Seeded demo patient that is always "present" in the waiting room. */
  simulated?: boolean;
}

/** What a physician sees about a visit. */
export interface DoctorVisitView {
  id: string;
  start: string;
  end: string;
  status: VisitStatus;
  present: boolean;
  waitingSince?: string;
  admittedAt?: string;
  endedAt?: string;
  patientName: string;
  patientDateOfBirth: string;
  reason: string;
  invitationPath: string;
}

export type PatientPhase = 'too_early' | 'waiting' | 'in_call' | 'ended' | 'cancelled' | 'expired';

/** What a patient sees about their own visit. No other patients' data. */
export interface PatientStatus {
  phase: PatientPhase;
  startsAt: string;
  canEnterAt: string;
  waitingSince?: string;
  queuePosition?: number;
  doctorBusy: boolean;
  minutesLate: number;
}

// Clinic policy (spec §2.2). Make these per-clinic settings later.
export const EARLY_ENTRY_MIN = 15;
export const LATE_ENTRY_MIN = 30;
export const PRESENCE_TIMEOUT_MS = 20_000;
export const MAX_VERIFY_ATTEMPTS = 5;
export const BOOKING_LEAD_MIN = 30;
export const BOOKING_HORIZON_DAYS = 60;
