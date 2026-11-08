// Usage: npm run fhir:reset -- <clinicId> [dir]
// Wipes the clinic's resources, re-imports Synthea data and re-seeds appointments.
import { seedAppointments } from './lib/appointments';
import { adminClient, deleteResources, fail, main, requireMockClinic } from './lib/cli';
import { DEFAULT_SYNTHEA_DIR, importSynthea, printStats } from './lib/import';

await main(async () => {
  const [clinicId, dir = DEFAULT_SYNTHEA_DIR] = process.argv.slice(2);
  if (!clinicId) fail('usage: npm run fhir:reset -- <clinicId> [dir]');

  const db = adminClient();
  await requireMockClinic(db, clinicId);
  console.log(`resetting '${clinicId}'...`);
  await deleteResources(db, clinicId);
  printStats(await importSynthea(db, clinicId, dir));
  const appointments = await seedAppointments(db, clinicId);
  console.log(`seeded ${appointments.length} appointments`);
});
