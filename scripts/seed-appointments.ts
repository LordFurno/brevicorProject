// Usage: npm run fhir:seed -- <clinicId> [--clinicsoft=<practice> | --no-clinicsoft]
// Writes one appointment plan to the FHIR clinic and the same plan to a
// ClinicSoft practice (default 'demo', if loaded), then assigns DEMO_PHONE_NUMBERS / DEMO_EMAILS.
import { seedAppointments } from './lib/appointments';
import { adminClient, fail, main, requireMockClinic } from './lib/cli';
import { clinicSoftOption } from './lib/clinicsoft';
import { parseDemoEmails, parseDemoPhones } from './lib/demo-contacts';

await main(async () => {
  const args = process.argv.slice(2);
  const clinicId = args.find((a) => !a.startsWith('--'));
  if (!clinicId) fail('usage: npm run fhir:seed -- <clinicId> [--clinicsoft=<practice> | --no-clinicsoft]');

  const db = adminClient();
  await requireMockClinic(db, clinicId);
  const result = await seedAppointments(db, clinicId, {
    clinicSoftPractice: clinicSoftOption(args),
    demoPhones: parseDemoPhones(process.env.DEMO_PHONE_NUMBERS),
    demoEmails: parseDemoEmails(process.env.DEMO_EMAILS),
  });
  const cancelled = result.appointments.filter((a) => a.status === 'cancelled').length;
  console.log(`seeded ${result.appointments.length} appointments in '${clinicId}' (${cancelled} cancelled)`);
  console.log(result.clinicSoftPractice ? `same plan written to ClinicSoft practice '${result.clinicSoftPractice}'` : 'ClinicSoft: skipped (not loaded)');
  console.log(
    result.demoContacts > 0
      ? `demo contacts assigned to ${result.demoContacts} patient(s) with appointments today; all other phones/emails cleared`
      : 'no DEMO_PHONE_NUMBERS / DEMO_EMAILS set: no patient has a phone number or email',
  );
});
