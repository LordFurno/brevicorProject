// Load .env.local for tests that talk to Supabase. Variables already set in the
// shell win; a missing file is fine (those tests skip themselves).
try {
  process.loadEnvFile('.env.local');
} catch {
  // no .env.local
}

process.env.FHIR_LOG ??= 'silent';

// Tests never send real messages, whatever .env.local or the shell says.
process.env.NOTIFY_SMS_PROVIDER = 'console';
process.env.NOTIFY_EMAIL_PROVIDER = 'console';
