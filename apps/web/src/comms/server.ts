import type { CommsProviderId, CommsServerProvider } from './types';
import { localServer } from './local/server';
import { twilioServer } from './twilio/server';

const providers: Record<CommsProviderId, CommsServerProvider> = {
  local: localServer,
  twilio: twilioServer,
};

/** Server-side provider selected by COMMS_PROVIDER (default: local). */
export function getCommsServer(): CommsServerProvider {
  const id = (process.env.COMMS_PROVIDER || 'local') as CommsProviderId;
  const provider = providers[id];
  if (!provider) throw new Error(`Unknown COMMS_PROVIDER "${id}"`);
  return provider;
}
