// Usage: npm run fhir:import -- <clinicId> <dir> [--max-encounters N]
import { adminClient, fail, main, requireMockClinic } from './lib/cli';
import { DEFAULT_MAX_ENCOUNTERS, importSynthea, printStats } from './lib/import';

await main(async () => {
  const [clinicId, dir, flag, value] = process.argv.slice(2);
  if (!clinicId || !dir) fail('usage: npm run fhir:import -- <clinicId> <dir> [--max-encounters N]');
  let maxEncounters = DEFAULT_MAX_ENCOUNTERS;
  if (flag === '--max-encounters') {
    maxEncounters = Number(value);
    if (!Number.isInteger(maxEncounters) || maxEncounters < 0) fail('--max-encounters must be a non-negative integer');
  }

  const db = adminClient();
  await requireMockClinic(db, clinicId);
  console.log(`importing ${dir} into '${clinicId}'...`);
  printStats(await importSynthea(db, clinicId, dir, maxEncounters));
});
