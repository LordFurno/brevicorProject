// Usage: npm run fhir:seed -- <clinicId>
import { seedAppointments } from './lib/appointments';
import { adminClient, fail, main, requireMockClinic } from './lib/cli';

await main(async () => {
  const [clinicId] = process.argv.slice(2);
  if (!clinicId) fail('usage: npm run fhir:seed -- <clinicId>');

  const db = adminClient();
  await requireMockClinic(db, clinicId);
  const appointments = await seedAppointments(db, clinicId);
  const cancelled = appointments.filter((a) => a.status === 'cancelled').length;
  console.log(`seeded ${appointments.length} appointments in '${clinicId}' (${cancelled} cancelled)`);
  console.log(`first: ${appointments[0].start}  last: ${appointments.at(-1)!.start}`);
});
