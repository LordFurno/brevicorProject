import { createCallEmitter } from '../emitter';
import type { CallSession, CommsClient } from '../types';

// Local demo provider: a real peer-to-peer WebRTC call, signalled over a
// BroadcastChannel. Works between two tabs/windows of the SAME browser
// (open the doctor dashboard in one tab and the patient link in another).
// For calls between different devices, use a hosted provider (Twilio, etc.).

type Signal =
  | { type: 'hello' | 'here' | 'bye'; from: string }
  | { type: 'offer' | 'answer'; from: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; from: string; candidate: RTCIceCandidateInit };
type Outgoing = Signal extends infer S ? (S extends unknown ? Omit<S, 'from'> : never) : never;

export const localClient: CommsClient = {
  async join(creds, localStream): Promise<CallSession> {
    const em = createCallEmitter();
    const channel = new BroadcastChannel(`brevicor-call:${creds.roomName}`);
    const me = crypto.randomUUID();
    // Only one side makes offers, which avoids offer "glare".
    const isOfferer = creds.role === 'physician';
    let pc: RTCPeerConnection | null = null;
    let closed = false;

    const send = (msg: Outgoing) => {
      if (!closed) channel.postMessage({ ...msg, from: me });
    };

    const newPeer = () => {
      pc?.close();
      const peer = new RTCPeerConnection();
      const remote = new MediaStream();
      localStream.getTracks().forEach((t) => peer.addTrack(t, localStream));
      peer.onicecandidate = (e) => {
        if (e.candidate) send({ type: 'ice', candidate: e.candidate.toJSON() });
      };
      peer.ontrack = (e) => {
        remote.addTrack(e.track);
        em.setRemote(new MediaStream(remote.getTracks()));
      };
      peer.onconnectionstatechange = () => {
        if (peer !== pc) return;
        const s = peer.connectionState;
        if (s === 'connected') em.setState('connected');
        else if (s === 'disconnected') em.setState('reconnecting');
        else if (s === 'failed') {
          em.setRemote(null);
          em.setState('reconnecting');
          if (isOfferer) void offer();
        }
      };
      pc = peer;
      return peer;
    };

    const offer = async () => {
      const peer = newPeer();
      await peer.setLocalDescription(await peer.createOffer());
      send({ type: 'offer', sdp: peer.localDescription!.toJSON() });
    };

    const handle = async (m: Signal) => {
      if (!m || m.from === me || closed) return;
      switch (m.type) {
        case 'hello':
          if (isOfferer) await offer();
          else send({ type: 'here' });
          break;
        case 'here':
          if (isOfferer) await offer();
          break;
        case 'offer': {
          if (isOfferer) return;
          const peer = newPeer();
          await peer.setRemoteDescription(m.sdp);
          await peer.setLocalDescription(await peer.createAnswer());
          send({ type: 'answer', sdp: peer.localDescription!.toJSON() });
          break;
        }
        case 'answer':
          if (isOfferer && pc?.signalingState === 'have-local-offer') await pc.setRemoteDescription(m.sdp);
          break;
        case 'ice':
          try {
            await pc?.addIceCandidate(m.candidate);
          } catch {
            /* stale candidate from a previous connection */
          }
          break;
        case 'bye':
          pc?.close();
          pc = null;
          em.setRemote(null);
          break;
      }
    };

    // Process signals strictly in order (ICE must not race the offer/answer).
    let queue = Promise.resolve();
    channel.onmessage = (e: MessageEvent<Signal>) => {
      queue = queue.then(() => handle(e.data)).catch(() => undefined);
    };

    const onPageHide = () => send({ type: 'bye' });
    window.addEventListener('pagehide', onPageHide);

    send({ type: 'hello' });
    em.setState('connected');

    const setEnabled = (kind: 'audio' | 'video', on: boolean) =>
      localStream.getTracks().forEach((t) => {
        if (t.kind === kind) t.enabled = on;
      });

    return {
      onRemoteStream: em.onRemoteStream,
      onStateChange: em.onStateChange,
      setMicEnabled: (on) => setEnabled('audio', on),
      setCameraEnabled: (on) => setEnabled('video', on),
      disconnect() {
        if (closed) return;
        send({ type: 'bye' });
        closed = true;
        window.removeEventListener('pagehide', onPageHide);
        pc?.close();
        pc = null;
        channel.close();
        em.setRemote(null);
        em.setState('disconnected');
      },
    };
  },
};
