import type { CommsServerProvider } from '../types';

// Zero-config demo provider: no account, no keys, no cost.
export const localServer: CommsServerProvider = {
  id: 'local',
  async issueJoinCredentials({ roomName, identity, role }) {
    return { provider: 'local', roomName, identity, role };
  },
};
