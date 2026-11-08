import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { maskRecipient } from '@/lib/notify/phone';
import { createChannels } from '@/lib/notify/providers';
import { consoleChannel } from '@/lib/notify/providers/console';
import { twilioError } from '@/lib/notify/providers/twilio-errors';
import { DeliveryError } from '@/lib/notify/providers/types';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('provider selection', () => {
  const env = (vars: Record<string, string | undefined>) => ({ ...vars }) as NodeJS.ProcessEnv;
  const TWILIO = {
    TWILIO_ACCOUNT_SID: `AC${'0'.repeat(32)}`,
    TWILIO_API_KEY_SID: `SK${'0'.repeat(32)}`,
    TWILIO_API_KEY_SECRET: 'secret',
    TWILIO_SMS_FROM: '+15005550006',
  };

  it('defaults to console for both channels', async () => {
    const channels = await createChannels(env({}));
    expect([channels.sms.provider, channels.email.provider]).toEqual(['console', 'console']);
  });

  it('twilio with credentials -> twilio; without -> console', async () => {
    expect((await createChannels(env({ NOTIFY_SMS_PROVIDER: 'twilio', ...TWILIO }))).sms.provider).toBe('twilio');
    expect((await createChannels(env({ NOTIFY_SMS_PROVIDER: 'twilio', ...TWILIO, TWILIO_API_KEY_SECRET: undefined }))).sms.provider).toBe('console');
  });

  it('TWILIO_TRIAL_TEMPLATES marks deliveries as twilio-trial and maps each template to a predefined one', async () => {
    expect((await createChannels(env({ NOTIFY_SMS_PROVIDER: 'twilio', ...TWILIO, TWILIO_TRIAL_TEMPLATES: 'true' }))).sms.provider).toBe('twilio-trial');
    expect((await createChannels(env({ NOTIFY_SMS_PROVIDER: 'twilio', ...TWILIO, TWILIO_TRIAL_TEMPLATES: 'no' }))).sms.provider).toBe('twilio');
    const { trialTemplate } = await import('@/lib/notify/providers/twilio-sms');
    expect(trialTemplate('patient_waiting')).toBe('sms_internal_alerts');
    for (const t of ['visit_invitation', 'visit_rescheduled', 'visit_cancelled']) expect(trialTemplate(t)).toBe('sms_appointment_reminders');
  });

  it('an unknown provider fails each delivery visibly instead of not sending', async () => {
    const { sms, email } = await createChannels(env({ NOTIFY_SMS_PROVIDER: 'pigeon', NOTIFY_EMAIL_PROVIDER: 'toString' }));
    for (const channel of [sms, email]) {
      const err = await channel.send({ to: 'x', text: 'y', templateId: 't' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DeliveryError);
      expect((err as DeliveryError).code).toBe('config:unknown_provider');
    }
  });
});

describe('console provider', () => {
  it('logs channel, masked recipient and template id, never the body', async () => {
    vi.stubEnv('FHIR_LOG', '');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { providerMessageId } = await consoleChannel('sms').send({ to: '+16135550199', text: 'SECRET BODY', templateId: 'visit_invitation' });
    expect(providerMessageId).toMatch(/^console-/);
    const line = String(log.mock.calls[0][0]);
    expect(JSON.parse(line)).toMatchObject({ evt: 'notify.console', channel: 'sms', to: '+1******0199', template: 'visit_invitation' });
    expect(line).not.toContain('SECRET');
    expect(line).not.toContain('5550199');
  });
});

describe('Twilio errors', () => {
  it('keep the code and our own hint, never Twilio text (it can contain the number)', () => {
    const err = twilioError({ status: 400, code: 21608, message: 'The number +16135550199 is unverified. Trial accounts cannot send messages to unverified numbers' });
    expect(err.code).toBe('twilio:21608');
    expect(err.detail).toContain('trial account can only text verified numbers');
    expect(`${err.message} ${err.detail}`).not.toContain('6135550199');
  });

  it('cover unknown codes, bare HTTP failures and network errors', () => {
    expect(twilioError({ code: 30007, message: 'x' })).toMatchObject({ code: 'twilio:30007', detail: expect.stringContaining('30007') });
    expect(twilioError({ code: 572006, status: 400 }).detail).toContain('TWILIO_TRIAL_TEMPLATES');
    expect(twilioError({ status: 500 }).code).toBe('twilio:http_500');
    expect(twilioError(new TypeError('fetch failed')).code).toBe('twilio:unreachable');
  });
});

describe('recipient masking', () => {
  it('shows only enough to tell recipients apart', () => {
    expect(maskRecipient('sms', '+16135550199')).toBe('+1******0199');
    expect(maskRecipient('sms', '+12')).toBe('******');
    expect(maskRecipient('email', 'aurelio.h@example.com')).toBe('a***@e***.com');
    expect(maskRecipient('email', 'not-an-email')).toBe('***');
  });
});

describe('boundaries', () => {
  it('nothing outside lib/notify/providers/ imports Twilio (apps/web has its own comms/twilio/)', () => {
    const offenders = ['app', 'lib', 'scripts'].flatMap((dir) => sourceFiles(dir)).filter((file) => {
      const normalized = file.split(path.sep).join('/');
      if (normalized.startsWith('lib/notify/providers/')) return false;
      return /from\s+['"]twilio(?:\/[^'"]*)?['"]|require\(\s*['"]twilio|import\(\s*['"]twilio/.test(readFileSync(file, 'utf8'));
    });
    expect(offenders).toEqual([]);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [full] : [];
  });
}
