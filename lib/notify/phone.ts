/**
 * Recipient helpers shared by the notification service and the seed scripts.
 * No server-only imports: scripts use these too.
 */

const E164 = /^\+[1-9]\d{6,14}$/;

/** E.164 as-is; a 10-digit (or 1 + 10-digit) North American number gets +1. Spaces, dashes, dots and brackets are ignored. */
export function normalizePhone(raw: string): string | undefined {
  const s = raw.replace(/[\s().-]/g, '');
  if (E164.test(s)) return s;
  if (/^[2-9]\d{9}$/.test(s)) return `+1${s}`;
  if (/^1[2-9]\d{9}$/.test(s)) return `+${s}`;
  return undefined;
}

/** What logs, the notification log and API responses show instead of a recipient: +1******0123, j***@g***.com. */
export function maskRecipient(channel: 'sms' | 'email', address: string): string {
  if (channel === 'sms') {
    return address.length > 6 ? `${address.slice(0, 2)}${'*'.repeat(address.length - 6)}${address.slice(-4)}` : '******';
  }
  const at = address.lastIndexOf('@');
  if (at < 1) return '***';
  const domain = address.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${address[0]}***@${domain[0] ?? ''}***${tld}`;
}
