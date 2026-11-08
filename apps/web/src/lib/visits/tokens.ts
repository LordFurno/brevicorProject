import { createHash, randomBytes } from 'node:crypto';
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export function newInviteToken(clinicId: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(clinicId)) throw new Error('Invalid clinic');
  // 160 random bits keep clinic-scoped demo links within a single SMS segment.
  return `${clinicId}.${randomBytes(20).toString('base64url')}`;
}
export function tokenClinic(token: string): string | null {
  // Accept earlier 192-bit invitations until explicitly rotated.
  return (
    /^([a-z0-9][a-z0-9-]{0,62})\.(?:[A-Za-z0-9_-]{27}|[A-Za-z0-9_-]{32})$/.exec(token)?.[1] ?? null
  );
}
export function appointmentVisitId(clinicId: string, ref: string) {
  const h = hashToken(JSON.stringify([clinicId, ref]));
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
