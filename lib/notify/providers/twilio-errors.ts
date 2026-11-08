import { DeliveryError } from './types';

/** Twilio error codes worth explaining (twilio.com/docs/api/errors). No SDK import: the service uses these too. */
const HINTS: Record<number, string> = {
  20003: 'Twilio rejected the credentials: check TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET.',
  20429: 'Twilio is rate limiting this account. Try again shortly.',
  21211: 'The recipient is not a valid phone number.',
  21212: 'TWILIO_SMS_FROM is not a valid phone number.',
  21266: 'The recipient and TWILIO_SMS_FROM are the same number.',
  21408: 'This Twilio account may not text this country (Messaging > Settings > Geo permissions).',
  21606: 'TWILIO_SMS_FROM is not an SMS-capable number on this Twilio account.',
  21608:
    'This Twilio trial account can only text verified numbers. Verify the recipient in the Twilio Console (Phone Numbers > Manage > Verified Caller IDs) or upgrade the account.',
  21610: 'The recipient replied STOP to this sender. Twilio delivers nothing until they reply START.',
  21614: 'The recipient number cannot receive SMS (not a mobile number).',
  21659: 'TWILIO_SMS_FROM is not a Twilio number on this account.',
  572006:
    "This Twilio trial account accepts only Twilio's predefined templates, not custom text. Set TWILIO_TRIAL_TEMPLATES=true to send those (recipients see Twilio's sample text), or upgrade the account.",
};

/** A Twilio failure as a DeliveryError. Twilio's own message is dropped: it can contain the recipient's number. */
export function twilioError(err: unknown): DeliveryError {
  const e = (err ?? {}) as { code?: unknown; status?: unknown };
  if (typeof e.code === 'number') return new DeliveryError(`twilio:${e.code}`, twilioHint(`twilio:${e.code}`));
  if (typeof e.status === 'number') return new DeliveryError(`twilio:http_${e.status}`, twilioHint(`twilio:http_${e.status}`));
  return new DeliveryError('twilio:unreachable', twilioHint('twilio:unreachable'));
}

/** Explanation for a stored 'twilio:…' error code. */
export function twilioHint(code: string): string {
  const value = code.slice('twilio:'.length);
  if (value === 'unreachable') return 'Could not reach Twilio (network error or timeout).';
  if (value.startsWith('http_')) return `Twilio returned HTTP ${value.slice(5)}.`;
  return HINTS[Number(value)] ?? `Twilio rejected the message (error ${value}, see twilio.com/docs/api/errors/${value}).`;
}
