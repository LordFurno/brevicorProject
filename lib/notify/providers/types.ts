export type ChannelId = 'sms' | 'email';

export const CHANNELS: readonly ChannelId[] = ['sms', 'email'];

export interface OutgoingMessage {
  /** E.164 phone number (sms) or email address. */
  to: string;
  subject?: string;
  text: string;
  html?: string;
  /** Which template produced the message, so a provider can log it instead of the body. */
  templateId: string;
}

/** One way of reaching people (SMS, email). Providers never log message bodies or full recipients. */
export interface NotificationChannel {
  readonly channel: ChannelId;
  /** e.g. 'twilio', 'console'. Recorded with every delivery. */
  readonly provider: string;
  send(message: OutgoingMessage): Promise<{ providerMessageId: string }>;
}

/**
 * The only error a provider throws. `code` is stable and safe to store
 * ('twilio:21608'); `detail` is fixed text we write, never the provider's own
 * message (those can contain the recipient's number).
 */
export class DeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = 'DeliveryError';
  }
}
