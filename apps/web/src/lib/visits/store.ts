import 'server-only';
import type { Visit, VisitEvent } from './types';
import { hashToken, tokenClinic } from './tokens';
import { adminClient } from '@/lib/supabase/admin';
export interface VisitFilter {
  clinicId: string;
  practitionerRef?: string;
  from: string;
  to: string;
}
export interface Mutation {
  visit: Visit;
  events: VisitEvent[];
}
export interface VisitStore {
  get(clinicId: string, id: string): Promise<Visit | null>;
  getByToken(token: string): Promise<Visit | null>;
  list(filter: VisitFilter): Promise<Visit[]>;
  mutate(
    clinicId: string,
    id: string,
    change: (visit: Visit | null) => Mutation | null,
  ): Promise<Mutation | null>;
}
const fields = {
  id: 'id',
  clinicId: 'clinic_id',
  appointmentRef: 'appointment_ref',
  patientRef: 'patient_ref',
  practitionerRef: 'practitioner_ref',
  encounterRef: 'encounter_ref',
  modality: 'modality',
  start: 'start',
  end: 'end',
  status: 'status',
  appointmentStatus: 'appointment_status',
  inviteTokenHash: 'invite_token_hash',
  roomName: 'room_name',
  waitingSince: 'waiting_since',
  lastSeenAt: 'last_seen_at',
  admittedAt: 'admitted_at',
  endedAt: 'ended_at',
  verifyAttempts: 'verify_attempts',
  revision: 'revision',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
} as const;
export function toRow(v: Visit): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([k, col]) => [col, v[k as keyof Visit] ?? null]),
  );
}
export function fromRow(row: Record<string, unknown>): Visit {
  const dates = new Set([
    'start',
    'end',
    'waitingSince',
    'lastSeenAt',
    'admittedAt',
    'endedAt',
    'createdAt',
    'updatedAt',
  ]);
  return Object.fromEntries(
    Object.entries(fields).map(([k, col]) => [
      k,
      row[col] == null
        ? undefined
        : dates.has(k)
          ? new Date(row[col] as string).toISOString()
          : row[col],
    ]),
  ) as unknown as Visit;
}
export function validateEvents(events: VisitEvent[]) {
  const keys = new Set([
    'start',
    'status',
    'notificationType',
    'result',
    'errorCode',
    'photoId',
    'source',
  ]);
  for (const e of events)
    for (const [k, v] of Object.entries(e.meta ?? {})) {
      if (!keys.has(k) || typeof v !== 'string' || v.length > 128)
        throw new Error('Invalid audit metadata');
    }
}
export class MemoryVisitStore implements VisitStore {
  private rows = new Map<string, Visit>();
  readonly events: (VisitEvent & { clinicId: string; visitId: string })[] = [];
  async get(clinicId: string, id: string) {
    const v = this.rows.get(id);
    return v?.clinicId === clinicId ? structuredClone(v) : null;
  }
  async getByToken(token: string) {
    const clinicId = tokenClinic(token);
    for (const v of this.rows.values())
      if (v.clinicId === clinicId && v.inviteTokenHash === hashToken(token))
        return structuredClone(v);
    return null;
  }
  async list(f: VisitFilter) {
    return [...this.rows.values()]
      .filter(
        (v) =>
          v.clinicId === f.clinicId &&
          (!f.practitionerRef || v.practitionerRef === f.practitionerRef) &&
          v.start >= f.from &&
          v.start < f.to,
      )
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((v) => structuredClone(v));
  }
  async mutate(clinicId: string, id: string, change: (v: Visit | null) => Mutation | null) {
    const current = this.rows.get(id);
    if (current && current.clinicId !== clinicId) throw new Error('Invalid visit scope');
    const result = change(current ? structuredClone(current) : null);
    if (!result) return null;
    if (result.visit.id !== id || result.visit.clinicId !== clinicId)
      throw new Error('Invalid visit scope');
    validateEvents(result.events);
    const visit = fromRow(
      toRow({
        ...result.visit,
        revision: current ? current.revision + 1 : 0,
        updatedAt: new Date().toISOString(),
      }),
    );
    this.rows.set(id, structuredClone(visit));
    this.events.push(
      ...structuredClone(result.events).map((e) => ({ ...e, clinicId, visitId: id })),
    );
    return { ...result, visit };
  }
}
export class SupabaseVisitStore implements VisitStore {
  constructor(private db = adminClient()) {}
  async get(clinicId: string, id: string) {
    const { data, error } = await this.db
      .from('visits')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error('Visit database unavailable');
    return data ? fromRow(data) : null;
  }
  async getByToken(token: string) {
    const clinicId = tokenClinic(token);
    if (!clinicId) return null;
    const { data, error } = await this.db
      .from('visits')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('invite_token_hash', hashToken(token))
      .maybeSingle();
    if (error) throw new Error('Visit database unavailable');
    return data ? fromRow(data) : null;
  }
  async list(f: VisitFilter) {
    const rows: Visit[] = [];
    for (let offset = 0; ; offset += 1000) {
      let q = this.db
        .from('visits')
        .select('*')
        .eq('clinic_id', f.clinicId)
        .gte('start', f.from)
        .lt('start', f.to)
        .order('start')
        .order('id')
        .range(offset, offset + 999);
      if (f.practitionerRef) q = q.eq('practitioner_ref', f.practitionerRef);
      const { data, error } = await q;
      if (error) throw new Error('Visit database unavailable');
      rows.push(...(data ?? []).map(fromRow));
      if ((data?.length ?? 0) < 1000) return rows;
    }
  }
  async mutate(
    clinicId: string,
    id: string,
    change: (v: Visit | null) => Mutation | null,
  ): Promise<Mutation | null> {
    for (let i = 0; i < 20; i++) {
      const current = await this.get(clinicId, id),
        result = change(current);
      if (!result) return null;
      validateEvents(result.events);
      const { data, error } = await this.db.rpc('memory_mutate_visit', {
        p_clinic: clinicId,
        p_id: id,
        p_revision: current?.revision ?? -1,
        p_row: toRow(result.visit),
        p_events: result.events,
      });
      if (error) throw new Error('Visit transaction failed');
      if (data) return { ...result, visit: (await this.get(clinicId, id))! };
    }
    throw new Error('Visit changed concurrently; please retry');
  }
}
const g = globalThis as typeof globalThis & { memoryVisits?: MemoryVisitStore };
export function getVisitStore(): VisitStore {
  if (process.env.VISIT_STORE === 'memory') {
    if (process.env.NODE_ENV === 'production')
      throw new Error('Memory visits are development/test only');
    return (g.memoryVisits ??= new MemoryVisitStore());
  }
  return new SupabaseVisitStore();
}
