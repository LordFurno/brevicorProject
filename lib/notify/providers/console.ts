import { randomUUID } from 'node:crypto';
import { logInfo } from '@/lib/fhir/log';
import { maskRecipient } from '../phone';
import type { ChannelId, NotificationChannel } from './types';

/** Sends nothing: logs the channel, masked recipient and template id. Never the body. */
export function consoleChannel(channel: ChannelId): NotificationChannel {
  return {
    channel,
    provider: 'console',
    async send(message) {
      const providerMessageId = `console-${randomUUID()}`;
      logInfo('notify.console', { channel, to: maskRecipient(channel, message.to), template: message.templateId, id: providerMessageId });
      return { providerMessageId };
    },
  };
}
