'use client';

import { useEffect, useRef, useState } from 'react';
import { loadCommsClient } from '@/comms/client';
import type { CallSession, CallState, JoinCredentials } from '@/comms/types';

/** Joins a call with whatever provider the server chose. Leaves on unmount. */
export function useCall(creds: JoinCredentials | null, localStream: MediaStream | null) {
  const [state, setState] = useState<CallState>('connecting');
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<CallSession | null>(null);

  useEffect(() => {
    if (!creds || !localStream) return;
    let cancelled = false;
    let s: CallSession | null = null;
    const offs: (() => void)[] = [];
    setError(null);

    (async () => {
      try {
        const client = await loadCommsClient(creds.provider);
        const joined = await client.join(creds, localStream);
        if (cancelled) {
          joined.disconnect();
          return;
        }
        s = joined;
        session.current = joined;
        // Respect mic/camera toggles made before joining.
        joined.setMicEnabled(localStream.getAudioTracks().some((t) => t.enabled));
        joined.setCameraEnabled(localStream.getVideoTracks().some((t) => t.enabled));
        offs.push(joined.onStateChange(setState), joined.onRemoteStream(setRemote));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not connect to the video call.');
      }
    })();

    return () => {
      cancelled = true;
      offs.forEach((off) => off());
      s?.disconnect();
      session.current = null;
      setRemote(null);
    };
  }, [creds, localStream]);

  return { state, remote, error, session };
}
