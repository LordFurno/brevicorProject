import { createHmac } from 'node:crypto';
import { FhirError } from '@/lib/fhir/outcome';
import type { ChannelId } from './providers/types';

export interface NotifyConfig {
  /** Links in notifications must point here (APP_BASE_URL). */
  appBaseUrl: string;
  /** Physicians seen this recently are "online": the in-app alert covers them, so no SMS for patient_waiting. */
  onlineWindowSeconds: number;
  /** Messages per recipient per clinic per rolling hour. */
  maxPerHour: number;
  /** Keys recipient_key. Derived from INTERNAL_SERVICE_TOKEN: rotating that resets dedupe and rate-limit history. */
  recipientSecret: Buffer;
}

export function notifyConfig(env: NodeJS.ProcessEnv = process.env): NotifyConfig {
  const appBaseUrl = env.APP_BASE_URL?.trim();
  if (!appBaseUrl || !URL.canParse(appBaseUrl)) throw new FhirError(500, 'exception', 'Notifications are not configured: APP_BASE_URL is missing or invalid');
  const token = env.INTERNAL_SERVICE_TOKEN;
  if (!token) throw new FhirError(500, 'exception', 'Notifications are not configured: INTERNAL_SERVICE_TOKEN is missing');
  return {
    appBaseUrl,
    onlineWindowSeconds: onlineWindowSeconds(env),
    maxPerHour: positiveInt(env.NOTIFY_MAX_PER_HOUR, 20),
    recipientSecret: createHmac('sha256', token).update('brevicor:notify:recipient-key:v1').digest(),
  };
}

export function onlineWindowSeconds(env: NodeJS.ProcessEnv = process.env): number {
  return positiveInt(env.NOTIFY_ONLINE_WINDOW_SECONDS, 60);
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value && Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Pseudonymous, stable id for a recipient: lets the log dedupe and rate-limit
 * per recipient without storing the number or address.
 */
export function recipientKey(secret: Buffer, channel: ChannelId, address: string): string {
  const normalized = channel === 'email' ? address.toLowerCase() : address;
  return createHmac('sha256', secret).update(`${channel}:${normalized}`).digest('hex').slice(0, 32);
}

const MAX_LINK_LENGTH = 512;

/**
 * True when `link` is under APP_BASE_URL: same scheme, host and port, and a
 * path inside the base path. A plain string prefix test is not enough
 * ("http://localhost:3000.evil.com" starts with "http://localhost:3000").
 * Returns the normalized URL to send, or null.
 */
export function allowedLink(link: string, appBaseUrl: string): string | null {
  if (link.length > MAX_LINK_LENGTH || /[\s\u0000-\u001f\u007f]/.test(link)) return null;
  if (!URL.canParse(link)) return null;
  const url = new URL(link);
  const base = new URL(appBaseUrl);
  if (url.username || url.password) return null;
  if (url.origin === 'null' || url.origin !== base.origin) return null;
  const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  if (url.pathname !== base.pathname && !url.pathname.startsWith(basePath)) return null;
  return url.href;
}
