import { syncVisits } from '../src/lib/visits/sync';
try {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    /* Shell configuration is also supported. */
  }
  const clinicId = process.argv[2];
  if (!clinicId) throw new Error('usage: npm run visits:sync -- <clinicId>');
  console.log(JSON.stringify({ clinicId, ...(await syncVisits(clinicId)) }));
} catch (e) {
  console.error(e instanceof Error ? e.message : 'Sync failed');
  process.exitCode = 1;
}
