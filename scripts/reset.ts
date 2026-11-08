// Usage: npm run fhir:reset -- <clinicId> [fhirDir] [csvDir] [--clinicsoft=<practice> | --no-clinicsoft]
// Wipes the clinic's resources, re-imports Synthea data, reloads the ClinicSoft
// practice (default 'demo') from Synthea CSV, and re-seeds one appointment plan into both.
import { seedAppointments } from './lib/appointments';
import { adminClient, deleteResources, fail, main, requireMockClinic } from './lib/cli';
import { clinicSoftOption, clinicSoftSummary, DEFAULT_CSV_DIR, loadClinicSoft } from './lib/clinicsoft';
import { parseDemoEmails, parseDemoPhones } from './lib/demo-contacts';
import { DEFAULT_MAX_ENCOUNTERS, DEFAULT_SYNTHEA_DIR, importSynthea, printStats } from './lib/import';
import { defaultCaps } from './lib/synthea';

await main(async () => {
  const args = process.argv.slice(2);
  const [clinicId, dir = DEFAULT_SYNTHEA_DIR, csvDir = DEFAULT_CSV_DIR] = args.filter((a) => !a.startsWith('--'));
  if (!clinicId) fail('usage: npm run fhir:reset -- <clinicId> [fhirDir] [csvDir] [--clinicsoft=<practice> | --no-clinicsoft]');
  const practice = clinicSoftOption(args);
  const demoPhones = parseDemoPhones(process.env.DEMO_PHONE_NUMBERS);
  const demoEmails = parseDemoEmails(process.env.DEMO_EMAILS);

  const db = adminClient();
  await requireMockClinic(db, clinicId);
  console.log(`resetting '${clinicId}'...`);
  await deleteResources(db, clinicId);
  const caps = defaultCaps(); // one "now" for both, so the medication window matches exactly
  printStats(await importSynthea(db, clinicId, dir, DEFAULT_MAX_ENCOUNTERS, caps));
  if (practice) {
    const s = await loadClinicSoft(db, practice, csvDir, DEFAULT_MAX_ENCOUNTERS, caps);
    console.log(`ClinicSoft '${practice}': ${clinicSoftSummary(s)}`);
  }
  const result = await seedAppointments(db, clinicId, { clinicSoftPractice: practice, demoPhones, demoEmails });
  console.log(`seeded ${result.appointments.length} appointments${result.clinicSoftPractice ? ` (also in ClinicSoft '${result.clinicSoftPractice}')` : ''}`);
  console.log(`patients given demo contacts: ${result.demoContacts}`);
});
