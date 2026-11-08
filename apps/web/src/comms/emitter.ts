import type { CallState } from './types';

/** Small helper shared by client implementations to back the CallSession events. */
export function createCallEmitter() {
  let state: CallState = 'connecting';
  let remote: MediaStream | null = null;
  const stateListeners = new Set<(s: CallState) => void>();
  const remoteListeners = new Set<(s: MediaStream | null) => void>();

  return {
    setState(next: CallState) {
      if (next === state) return;
      state = next;
      stateListeners.forEach((f) => f(next));
    },
    setRemote(next: MediaStream | null) {
      remote = next;
      remoteListeners.forEach((f) => f(next));
    },
    onStateChange(f: (s: CallState) => void) {
      stateListeners.add(f);
      f(state);
      return () => {
        stateListeners.delete(f);
      };
    },
    onRemoteStream(f: (s: MediaStream | null) => void) {
      remoteListeners.add(f);
      f(remote);
      return () => {
        remoteListeners.delete(f);
      };
    },
  };
}
