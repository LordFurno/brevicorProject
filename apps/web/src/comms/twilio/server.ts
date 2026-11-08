import twilio from 'twilio';
import type { CommsServerProvider } from '../types';

// Twilio Programmable Video. Needs an API key (Console → Account → API keys).
// Rooms are created on first join; recording is OFF by default (spec: no raw media retained).

function config() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKey = process.env.TWILIO_API_KEY_SID;
  const apiSecret = process.env.TWILIO_API_KEY_SECRET;
  if (!accountSid || !apiKey || !apiSecret) {
    throw new Error('Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET.');
  }
  return { accountSid, apiKey, apiSecret };
}

export const twilioServer: CommsServerProvider = {
  id: 'twilio',

  async issueJoinCredentials({ roomName, identity, role }) {
    const { accountSid, apiKey, apiSecret } = config();
    const { AccessToken } = twilio.jwt;
    const token = new AccessToken(accountSid, apiKey, apiSecret, { identity, ttl: 3600 });
    token.addGrant(new AccessToken.VideoGrant({ room: roomName }));
    return { provider: 'twilio', roomName, identity, role, token: token.toJwt() };
  },

  async endRoom(roomName) {
    const { accountSid, apiKey, apiSecret } = config();
    const client = twilio(apiKey, apiSecret, { accountSid });
    try {
      await client.video.v1.rooms(roomName).update({ status: 'completed' });
    } catch {
      // Room may never have been created or already ended — fine.
    }
  },
};
