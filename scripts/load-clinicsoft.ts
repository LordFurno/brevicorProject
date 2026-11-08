// Usage: npm run clinicsoft:load -- [practiceId=demo] [csvDir=./synthea-output/csv]
// Replaces a ClinicSoft practice's data with Synthea CSV output. Run fhir:seed
// afterwards to give it the same appointments as demo-mock.
import { adminClient, main } from './lib/cli';
import { DEFAULT_CSV_DIR, DEMO_CLINICSOFT_PRACTICE, loadClinicSoft } from './lib/clinicsoft';
import { DEFAULT_MAX_ENCOUNTERS } from './lib/import';

await main(async () => {
  const [practiceId = DEMO_CLINICSOFT_PRACTICE, csvDir = DEFAULT_CSV_DIR] = process.argv.slice(2);
  console.log(`loading ${csvDir} into ClinicSoft practice '${practiceId}'...`);
  const stats = await loadClinicSoft(adminClient(), practiceId, csvDir, DEFAULT_MAX_ENCOUNTERS);
  console.log(
    `loaded: organizations=${stats.organizations} providers=${stats.providers} patients=${stats.patients} encounters=${stats.encounters}`,
  );
});
