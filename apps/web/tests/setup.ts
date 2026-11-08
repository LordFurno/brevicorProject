import { vi } from 'vitest';
try {
  process.loadEnvFile('.env.local');
} catch {
  /* Optional for unit tests. */
}
process.env.NOTIFY_SMS_PROVIDER = 'console';
process.env.NOTIFY_EMAIL_PROVIDER = 'console';
// Network calls in unit tests are mocked. Integration uses the existing root
// console-only service in process, never a running Twilio-configured gateway.
vi.stubEnv('VISIT_STORE', 'memory');
