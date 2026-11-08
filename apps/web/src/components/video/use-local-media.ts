'use client';

import { useCallback, useEffect, useState } from 'react';

export interface LocalMedia {
  stream: MediaStream | null;
  error: string | null;
  micOn: boolean;
  camOn: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  toggleMic(): boolean;
  toggleCam(): boolean;
}

function describe(e: unknown) {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError') return 'Camera and microphone access is blocked. Allow access from the icon in your address bar, then reload.';
  if (name === 'NotFoundError') return 'We couldn’t find a camera or microphone on this device.';
  if (name === 'NotReadableError') return 'Your camera is being used by another app. Close it and try again.';
  return 'We couldn’t start your camera or microphone.';
}

/**
 * Owns the user's camera + mic for the whole visit (waiting room → call),
 * so the browser only asks for permission once.
 */
export function useLocalMedia(enabled = true): LocalMedia {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let acquired: MediaStream | null = null;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser can’t use a camera here. Try Chrome, Safari or Edge on a secure (https) page.');
        setStream(new MediaStream());
        return;
      }
      let problem: string | null = null;
      try {
        acquired = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (e) {
        problem = describe(e);
        try {
          acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
          problem = 'We couldn’t access your camera — you can still join with audio.';
        } catch {
          acquired = null;
        }
      }
      if (cancelled) {
        acquired?.getTracks().forEach((t) => t.stop());
        return;
      }
      setError(problem);
      setMicOn(true);
      setCamOn(!!acquired?.getVideoTracks().length);
      setStream(acquired ?? new MediaStream());
    })();

    return () => {
      cancelled = true;
      acquired?.getTracks().forEach((t) => t.stop());
      setStream(null);
    };
  }, [enabled]);

  const toggleMic = useCallback(() => {
    const next = !micOn;
    stream?.getAudioTracks().forEach((t) => (t.enabled = next));
    setMicOn(next);
    return next;
  }, [micOn, stream]);

  const toggleCam = useCallback(() => {
    const next = !camOn;
    stream?.getVideoTracks().forEach((t) => (t.enabled = next));
    setCamOn(next);
    return next;
  }, [camOn, stream]);

  return {
    stream,
    error,
    micOn,
    camOn,
    hasVideo: !!stream?.getVideoTracks().length,
    hasAudio: !!stream?.getAudioTracks().length,
    toggleMic,
    toggleCam,
  };
}
