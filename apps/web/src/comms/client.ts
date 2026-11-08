import type { CommsClient, CommsProviderId } from './types';

/**
 * Browser-side provider. Each SDK is code-split and only downloaded when used.
 * The server decides the provider (it's in the JoinCredentials), so the client
 * never needs its own config.
 */
export async function loadCommsClient(id: CommsProviderId): Promise<CommsClient> {
  switch (id) {
    case 'twilio':
      return (await import('./twilio/client')).twilioClient;
    case 'local':
      return (await import('./local/client')).localClient;
    default:
      throw new Error(`Unsupported video provider: ${id as string}`);
  }
}
