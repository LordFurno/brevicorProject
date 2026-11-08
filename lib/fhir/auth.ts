import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js';
import type { CallerLog } from './log';
import { FhirError } from './outcome';

/**
 * Who is calling the FHIR API, and for which clinic.
 *
 * - Physicians/staff: `Authorization: Bearer <Supabase access token>`. The
 *   clinic comes from their clinic_members rows; X-Clinic-Id picks one when
 *   they belong to several.
 * - Server-side code with no logged-in user: `Authorization: Bearer
 *   <INTERNAL_SERVICE_TOKEN>` plus X-Clinic-Id.
 *
 * Patients never call this API.
 */

export type MemberRole = 'physician' | 'staff' | 'admin';

export interface Membership {
  clinicId: string;
  role: MemberRole;
  practitionerRef: string | null;
}

export type Caller =
  | { kind: 'user'; userId: string; clinicId: string; practitionerRef: string | null; role: MemberRole }
  | { kind: 'service'; clinicId: string };

export interface AuthDeps {
  /** The user id for a valid end-user access token, else null. */
  verifyToken(token: string): Promise<string | null>;
  loadMemberships(userId: string): Promise<Membership[]>;
  /** INTERNAL_SERVICE_TOKEN. Service auth is off when unset or shorter than 32 chars. */
  serviceToken: string | undefined;
}

const MIN_SERVICE_TOKEN_LENGTH = 32;

export async function resolveCaller(
  req: Request,
  deps: AuthDeps,
  /** Told who the caller is as soon as their credentials check out (for logging). */
  identify: (caller: CallerLog) => void = () => {},
): Promise<Caller> {
  const token = bearerToken(req.headers.get('authorization'));
  if (!token) throw unauthenticated('Authentication required');
  const requested = req.headers.get('x-clinic-id')?.trim() || undefined;

  const service = deps.serviceToken;
  if (service && service.length >= MIN_SERVICE_TOKEN_LENGTH && tokensEqual(token, service)) {
    identify({ kind: 'service' });
    if (!requested) throw new FhirError(400, 'required', 'X-Clinic-Id is required with a service token');
    return { kind: 'service', clinicId: requested };
  }

  const userId = await deps.verifyToken(token);
  if (!userId) throw unauthenticated('Invalid or expired access token');
  identify({ kind: 'user', userId });

  const memberships = await deps.loadMemberships(userId);
  if (memberships.length === 0) throw forbidden('This account is not a member of any clinic');
  let membership: Membership | undefined;
  if (requested) {
    membership = memberships.find((m) => m.clinicId === requested);
    if (!membership) throw forbidden('This account is not a member of the requested clinic');
  } else if (memberships.length === 1) {
    membership = memberships[0];
  } else {
    throw new FhirError(400, 'required', 'X-Clinic-Id is required: this account belongs to several clinics');
  }
  return {
    kind: 'user',
    userId,
    clinicId: membership.clinicId,
    practitionerRef: membership.practitionerRef,
    role: membership.role,
  };
}

/** Constant-time comparison; hashing first means length differences leak nothing either. */
export function tokensEqual(a: string, b: string): boolean {
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/** Real dependencies: Supabase Auth for tokens, clinic_members for memberships. */
export function supabaseAuthDeps(db: SupabaseClient): AuthDeps {
  return {
    serviceToken: process.env.INTERNAL_SERVICE_TOKEN,

    async verifyToken(token) {
      // With asymmetric signing keys (this project: ES256) getClaims verifies
      // locally against the cached JWKS; otherwise it falls back to getUser().
      try {
        const { data, error } = await db.auth.getClaims(token);
        if (error) {
          if (isAuthRetryableFetchError(error)) throw unavailable();
          return null;
        }
        const claims = data?.claims;
        // Only end-user sessions count, not API keys or other roles.
        if (!claims?.sub || claims.role !== 'authenticated') return null;
        return claims.sub;
      } catch (err) {
        if (err instanceof FhirError) throw err;
        return null; // malformed token
      }
    },

    async loadMemberships(userId) {
      const { data, error } = await db
        .from('clinic_members')
        .select('clinic_id, role, practitioner_ref')
        .eq('user_id', userId);
      if (error) throw unavailable();
      return (data ?? []).map((row) => ({
        clinicId: row.clinic_id as string,
        role: row.role as MemberRole,
        practitionerRef: (row.practitioner_ref as string | null) ?? null,
      }));
    },
  };
}

function bearerToken(header: string | null): string | undefined {
  return /^Bearer\s+(\S+)\s*$/i.exec(header ?? '')?.[1];
}

function unauthenticated(message: string): FhirError {
  return new FhirError(401, 'login', message, undefined, { 'WWW-Authenticate': 'Bearer' });
}

function forbidden(message: string): FhirError {
  return new FhirError(403, 'forbidden', message);
}

function unavailable(): FhirError {
  return new FhirError(503, 'transient', 'Authentication is temporarily unavailable');
}
