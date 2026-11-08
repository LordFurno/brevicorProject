import type { SupabaseClient } from '@supabase/supabase-js';
import type { MemberRole } from '@/lib/fhir/auth';
import { fail } from './cli';

export interface MembershipInput {
  clinicId: string;
  role: MemberRole;
  practitionerRef: string | null;
}

/** Creates the user (email pre-confirmed) or resets the password of an existing one. Returns the user id. */
export async function ensureUser(db: SupabaseClient, email: string, password: string): Promise<string> {
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.data.user) return created.data.user.id;

  const existing = await findUserByEmail(db, email);
  if (!existing) fail(`could not create ${email}: ${created.error?.message ?? 'unknown error'}`);
  const updated = await db.auth.admin.updateUserById(existing, { password, email_confirm: true });
  if (updated.error) fail(`could not update ${email}: ${updated.error.message}`);
  return existing;
}

export const DEMO_PHYSICIANS = ['physician.one@demo.brevicor.test', 'physician.two@demo.brevicor.test'] as const;

export async function findUserByEmail(db: SupabaseClient, email: string): Promise<string | undefined> {
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail(`listing users failed: ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < 1000) return undefined;
  }
}

/**
 * Replaces the user's clinic memberships. Kept memberships are updated in
 * place, so their physician_contacts (which cascade from the membership) survive.
 */
export async function setMemberships(db: SupabaseClient, userId: string, memberships: MembershipInput[]): Promise<void> {
  const saved = await db.from('clinic_members').upsert(
    memberships.map((m) => ({
      user_id: userId,
      clinic_id: m.clinicId,
      role: m.role,
      practitioner_ref: m.practitionerRef,
    })),
    { onConflict: 'user_id,clinic_id' },
  );
  if (saved.error) fail(`saving memberships failed (${saved.error.code}): ${saved.error.message}`);
  let stale = db.from('clinic_members').delete().eq('user_id', userId);
  if (memberships.length > 0) stale = stale.not('clinic_id', 'in', `(${memberships.map((m) => m.clinicId).join(',')})`);
  const removed = await stale;
  if (removed.error) fail(`removing old memberships failed (${removed.error.code})`);
}

export function demoPassword(): string {
  const password = process.env.DEMO_USER_PASSWORD;
  if (!password || password.length < 8) fail('DEMO_USER_PASSWORD must be set (8+ characters) in .env.local');
  return password;
}
