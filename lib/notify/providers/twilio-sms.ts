import twilio from 'twilio';
import { twilioError } from './twilio-errors';
import type { NotificationChannel } from './types';

/**
 * SMS through Twilio Messaging, authenticated with an API key (Console →
 * Account → API keys). The only file outside apps/web/src/comms/twilio/ that
 * imports Twilio.
 */

export interface TwilioSmsConfig {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  /** An SMS-capable Twilio number (E.164) or a Messaging Service SID (MG…). */
  from: string;
  /**
   * TWILIO_TRIAL_TEMPLATES=true. Trial accounts reject custom text (error
   * 572006) and accept only Twilio's predefined templates, sent by name as the
   * body. The recipient then sees Twilio's sample text, not ours.
   */
  trialTemplates: boolean;
}

const TIMEOUT_MS = 8_000;

/** The closest predefined trial template for each of our templates (twilio.com/docs/usage/trials/try-out-sms). */
const TRIAL_TEMPLATES: Record<string, string> = {
  patient_waiting: 'sms_internal_alerts',
  visit_invitation: 'sms_appointment_reminders',
  visit_rescheduled: 'sms_appointment_reminders',
  visit_cancelled: 'sms_appointment_reminders',
};

export function trialTemplate(templateId: string): string {
  return TRIAL_TEMPLATES[templateId] ?? 'sms_account_alerts';
}

/** Null when any credential is missing (the caller falls back to the console provider). */
export function twilioSmsConfig(env: NodeJS.ProcessEnv): TwilioSmsConfig | null {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const apiKeySid = env.TWILIO_API_KEY_SID;
  const apiKeySecret = env.TWILIO_API_KEY_SECRET;
  const from = env.TWILIO_SMS_FROM;
  if (!accountSid || !apiKeySid || !apiKeySecret || !from) return null;
  return { accountSid, apiKeySid, apiKeySecret, from, trialTemplates: /^(true|1)$/i.test(env.TWILIO_TRIAL_TEMPLATES ?? '') };
}

export function twilioSms(config: TwilioSmsConfig): NotificationChannel {
  const client = twilio(config.apiKeySid, config.apiKeySecret, { accountSid: config.accountSid, timeout: TIMEOUT_MS });
  const sender = /^MG[0-9a-f]{32}$/i.test(config.from) ? { messagingServiceSid: config.from } : { from: config.from };
  return {
    channel: 'sms',
    // Recorded with each delivery, so trial sends (Twilio's text, not ours) are never mistaken for real ones.
    provider: config.trialTemplates ? 'twilio-trial' : 'twilio',
    async send(message) {
      const body = config.trialTemplates ? trialTemplate(message.templateId) : message.text;
      try {
        const sent = await client.messages.create({ to: message.to, body, ...sender });
        return { providerMessageId: sent.sid };
      } catch (err) {
        throw twilioError(err);
      }
    },
  };
}
