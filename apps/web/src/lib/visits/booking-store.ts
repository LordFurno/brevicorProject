import type { Visit } from './booking-types';
import { bookingEnabled } from '@/lib/booking';

// Isolated legacy booking preview. This adapter must never use Supabase.

export interface VisitStore {
  insert(v: Visit): Promise<void>;
  get(id: string): Promise<Visit | null>;
  getByToken(token: string): Promise<Visit | null>;
  update(id: string, patch: Partial<Visit>): Promise<Visit | null>;
  /** Always tenant-scoped: clinicId is required. */
  list(filter: {
    clinicId: string;
    practitionerId: string;
    from: string;
    to: string;
  }): Promise<Visit[]>;
}

class MemoryVisitStore implements VisitStore {
  private byId = new Map<string, Visit>();

  async insert(v: Visit) {
    this.byId.set(v.id, structuredClone(v));
  }

  async get(id: string) {
    const v = this.byId.get(id);
    return v ? structuredClone(v) : null;
  }

  async getByToken(token: string) {
    if (!token) return null;
    for (const v of this.byId.values()) if (v.inviteToken === token) return structuredClone(v);
    return null;
  }

  async update(id: string, patch: Partial<Visit>) {
    const v = this.byId.get(id);
    if (!v) return null;
    const next = { ...v, ...patch, id: v.id, clinicId: v.clinicId };
    this.byId.set(id, next);
    return structuredClone(next);
  }

  async list({
    clinicId,
    practitionerId,
    from,
    to,
  }: {
    clinicId: string;
    practitionerId: string;
    from: string;
    to: string;
  }) {
    return [...this.byId.values()]
      .filter(
        (v) =>
          v.clinicId === clinicId &&
          v.practitionerId === practitionerId &&
          v.start >= from &&
          v.start < to,
      )
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((v) => structuredClone(v));
  }
}

// Survive hot reloads and share one instance across route bundles.
const g = globalThis as unknown as { __brevicorVisits?: MemoryVisitStore };

export function getVisitStore(): VisitStore {
  if (!bookingEnabled()) throw new Error('Development booking is disabled');
  if (!g.__brevicorVisits) {
    const store = new MemoryVisitStore();

    g.__brevicorVisits = store;
  }
  return g.__brevicorVisits;
}
