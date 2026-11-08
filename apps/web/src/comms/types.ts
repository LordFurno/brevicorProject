// Provider-agnostic video calling contract.
//
// To add a provider (Daily, LiveKit, Vonage, …):
//   1. src/comms/<name>/server.ts → implements CommsServerProvider
//   2. src/comms/<name>/client.ts → implements CommsClient
//   3. register it in src/comms/server.ts and src/comms/client.ts
//   4. set COMMS_PROVIDER=<name>
// Nothing in pages/components imports a vendor SDK directly.

export type CommsProviderId = 'local' | 'twilio';
export type CallRole = 'physician' | 'patient';

/** Everything a browser needs to join a room. Issued by our server, short-lived. */
export interface JoinCredentials {
  provider: CommsProviderId;
  roomName: string;
  /** Opaque, non-identifying participant id (never a patient name). */
  identity: string;
  role: CallRole;
  token?: string;
}

export interface CommsServerProvider {
  id: CommsProviderId;
  issueJoinCredentials(input: { roomName: string; identity: string; role: CallRole }): Promise<JoinCredentials>;
  /** Close the room for everyone (best effort). */
  endRoom?(roomName: string): Promise<void>;
}

export type CallState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface CallSession {
  /** Fires immediately with the current value, then on every change. Returns an unsubscribe fn. */
  onRemoteStream(cb: (stream: MediaStream | null) => void): () => void;
  onStateChange(cb: (state: CallState) => void): () => void;
  setMicEnabled(on: boolean): void;
  setCameraEnabled(on: boolean): void;
  /** Leaves the room. Does NOT stop the local camera — the caller owns it. */
  disconnect(): void;
}

export interface CommsClient {
  join(credentials: JoinCredentials, localStream: MediaStream): Promise<CallSession>;
}
