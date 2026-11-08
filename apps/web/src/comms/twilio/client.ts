import { connect, LocalAudioTrack, LocalVideoTrack } from 'twilio-video';
import type { RemoteTrack } from 'twilio-video';
import { createCallEmitter } from '../emitter';
import type { CallSession, CommsClient } from '../types';

export const twilioClient: CommsClient = {
  async join(creds, localStream): Promise<CallSession> {
    if (!creds.token) throw new Error('Missing Twilio access token');
    const em = createCallEmitter();

    // Reuse the camera/mic the user already approved in the waiting room.
    const localTracks = localStream
      .getTracks()
      .map((t) => (t.kind === 'audio' ? new LocalAudioTrack(t) : new LocalVideoTrack(t)));

    const room = await connect(creds.token, {
      name: creds.roomName,
      tracks: localTracks,
      dominantSpeaker: false,
      networkQuality: false,
    });
    em.setState('connected');

    const remoteTracks = new Set<MediaStreamTrack>();
    const publish = () => em.setRemote(remoteTracks.size ? new MediaStream([...remoteTracks]) : null);

    room.on('trackSubscribed', (track: RemoteTrack) => {
      if ('mediaStreamTrack' in track) {
        remoteTracks.add(track.mediaStreamTrack);
        publish();
      }
    });
    room.on('trackUnsubscribed', (track: RemoteTrack) => {
      if ('mediaStreamTrack' in track) {
        remoteTracks.delete(track.mediaStreamTrack);
        publish();
      }
    });
    room.on('participantDisconnected', () => {
      remoteTracks.clear();
      publish();
    });
    room.on('reconnecting', () => em.setState('reconnecting'));
    room.on('reconnected', () => em.setState('connected'));
    room.on('disconnected', () => {
      remoteTracks.clear();
      publish();
      em.setState('disconnected');
    });

    const setEnabled = (kind: 'audio' | 'video', on: boolean) =>
      localTracks.forEach((t) => {
        if (t.kind === kind) {
          if (on) t.enable();
          else t.disable();
        }
      });

    return {
      onRemoteStream: em.onRemoteStream,
      onStateChange: em.onStateChange,
      setMicEnabled: (on) => setEnabled('audio', on),
      setCameraEnabled: (on) => setEnabled('video', on),
      disconnect: () => room.disconnect(),
    };
  },
};
