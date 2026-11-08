import type { ChannelId } from './providers/types';

export const NOTIFICATION_TYPES = ['patient_waiting', 'visit_invitation', 'visit_cancelled', 'visit_rescheduled'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** `sending` is held only while a message is in flight; it is what stops two concurrent heartbeats sending twice. */
export type DeliveryStatus = 'sending' | 'sent' | 'failed' | 'skipped';

/** One recipient on one channel, as returned by the API. Recipients are always masked. */
export interface DeliveryResult {
  channel: ChannelId;
  status: DeliveryStatus;
  recipient: string | null;
  provider: string | null;
  providerMessageId: string | null;
  errorCode: string | null;
  /** Fixed explanatory text for an error code (never provider text). */
  detail?: string;
}

export interface EventResult {
  type: NotificationType;
  dedupeKey: string;
  /** True when this dedupeKey had already been processed: nothing was sent this time. */
  deduplicated: boolean;
  results: DeliveryResult[];
}
