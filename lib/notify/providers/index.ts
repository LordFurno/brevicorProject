import { logWarning } from '@/lib/fhir/log';
import { consoleChannel } from './console';
import { DeliveryError, type ChannelId, type NotificationChannel } from './types';

/**
 * Picks each channel's provider from NOTIFY_SMS_PROVIDER / NOTIFY_EMAIL_PROVIDER
 * (default: console). A real email provider is one new file in this folder,
 * one entry in EMAIL_PROVIDERS, and NOTIFY_EMAIL_PROVIDER=<its name>.
 */

type Factory = (env: NodeJS.ProcessEnv) => Promise<NotificationChannel>;

const SMS_PROVIDERS: Record<string, Factory> = {
  console: async () => consoleChannel('sms'),
  async twilio(env) {
    // Imported on demand, so Twilio is only loaded when it is the SMS provider.
    const { twilioSms, twilioSmsConfig } = await import('./twilio-sms');
    const config = twilioSmsConfig(env);
    if (config) return twilioSms(config);
    logWarning('notify.config', { channel: 'sms', issue: 'twilio credentials missing; using the console provider' });
    return consoleChannel('sms');
  },
};

const EMAIL_PROVIDERS: Record<string, Factory> = {
  console: async () => consoleChannel('email'),
};

const SETTINGS: Record<ChannelId, { env: string; providers: Record<string, Factory> }> = {
  sms: { env: 'NOTIFY_SMS_PROVIDER', providers: SMS_PROVIDERS },
  email: { env: 'NOTIFY_EMAIL_PROVIDER', providers: EMAIL_PROVIDERS },
};

export type Channels = Record<ChannelId, NotificationChannel>;

export async function createChannels(env: NodeJS.ProcessEnv = process.env): Promise<Channels> {
  const [sms, email] = await Promise.all([createChannel('sms', env), createChannel('email', env)]);
  return { sms, email };
}

async function createChannel(channel: ChannelId, env: NodeJS.ProcessEnv): Promise<NotificationChannel> {
  const { env: name, providers } = SETTINGS[channel];
  const provider = env[name]?.trim() || 'console';
  const factory = Object.hasOwn(providers, provider) ? providers[provider] : undefined;
  return factory ? factory(env) : misconfigured(channel, provider, `${name} must be one of: ${Object.keys(providers).join(', ')}`);
}

/** An unknown provider name fails every delivery on that channel (visibly), rather than silently not sending. */
function misconfigured(channel: ChannelId, provider: string, detail: string): NotificationChannel {
  return {
    channel,
    provider,
    async send() {
      throw new DeliveryError('config:unknown_provider', detail);
    },
  };
}
