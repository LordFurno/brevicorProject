// Usage: npm run notify:contacts
// Gives the demo physicians an SMS contact in every clinic where they are a
// physician, from DEMO_PHYSICIAN_PHONE (comma-separated: physician.one gets the
// first, physician.two the second, or the first if there is only one).
// Run after fhir:users. Keeps last_seen_at; prints masked numbers only.
import { maskRecipient, normalizePhone } from '@/lib/notify/phone';
import { adminClient, fail, main } from './lib/cli';
import { DEMO_PHYSICIANS, findUserByEmail } from './lib/users';

await main(async () => {
  const phones = (process.env.DEMO_PHYSICIAN_PHONE ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((raw) => {
    const phone = normalizePhone(raw);
    if (!phone) fail('DEMO_PHYSICIAN_PHONE must be phone numbers: E.164 (+16135550123) or 10-digit North American (6135550123)');
    return phone;
  });
  if (phones.length === 0) fail('set DEMO_PHYSICIAN_PHONE in .env.local (a number you control, verified on a Twilio trial account)');

  const db = adminClient();
  for (const [i, email] of DEMO_PHYSICIANS.entries()) {
    const userId = await findUserByEmail(db, email);
    if (!userId) fail(`${email} does not exist: run npm run fhir:users first`);
    const { data, error } = await db.from('clinic_members').select('clinic_id').eq('user_id', userId).eq('role', 'physician');
    if (error) fail(`reading memberships failed (${error.code})`);
    const clinics = (data ?? []).map((m) => m.clinic_id as string);
    const phone = phones[Math.min(i, phones.length - 1)];
    if (clinics.length > 0) {
      const saved = await db.from('physician_contacts').upsert(
        clinics.map((clinicId) => ({ user_id: userId, clinic_id: clinicId, phone, channels: ['sms'], updated_at: new Date().toISOString() })),
        { onConflict: 'user_id,clinic_id' },
      );
      if (saved.error) fail(`saving contacts failed (${saved.error.code}): ${saved.error.message}`);
    }
    console.log(`${email}: ${clinics.join(', ') || '(no physician memberships)'} -> sms ${maskRecipient('sms', phone)}`);
  }
});
