// Usage: npm run fhir:users
// Creates (or resets) the demo logins and links them to clinics and to
// Synthea Practitioners that have seeded appointments. Run after fhir:seed.
import { FHIR_RESOURCES_TABLE } from '@/lib/fhir/providers/mock';
import { adminClient, fail, main } from './lib/cli';
import { DEMO_PHYSICIANS, demoPassword, ensureUser, setMemberships } from './lib/users';

const MOCK_CLINIC = 'demo-mock';
const FHIR_CLINIC = 'hapi-public';
// ClinicSoft holds the same Synthea data and appointment plan, so the same Practitioner ids apply.
const ADAPTER_CLINIC = 'demo-clinicsoft';

await main(async () => {
  const db = adminClient();
  const password = demoPassword();
  const [first, second] = await practitionersWithAppointments(db, MOCK_CLINIC);
  if (!first || !second) fail(`'${MOCK_CLINIC}' needs appointments for two practitioners: run npm run fhir:seed -- ${MOCK_CLINIC}`);

  const users = [
    {
      email: DEMO_PHYSICIANS[0],
      memberships: [
        { clinicId: MOCK_CLINIC, role: 'physician' as const, practitionerRef: first },
        { clinicId: ADAPTER_CLINIC, role: 'physician' as const, practitionerRef: first },
      ],
    },
    {
      // Belongs to three clinics backed by different EHRs, so X-Clinic-Id selects one.
      email: DEMO_PHYSICIANS[1],
      memberships: [
        { clinicId: MOCK_CLINIC, role: 'physician' as const, practitionerRef: second },
        { clinicId: FHIR_CLINIC, role: 'staff' as const, practitionerRef: null },
        { clinicId: ADAPTER_CLINIC, role: 'physician' as const, practitionerRef: second },
      ],
    },
  ];

  for (const user of users) {
    const userId = await ensureUser(db, user.email, password);
    await setMemberships(db, userId, user.memberships);
    const summary = user.memberships.map((m) => `${m.clinicId} (${m.role}${m.practitionerRef ? `, ${m.practitionerRef}` : ''})`);
    console.log(`${user.email}: ${summary.join('; ')}`);
  }
  console.log('password: DEMO_USER_PASSWORD in .env.local. Get a token with: npm run -s fhir:token -- <email>');
  console.log('SMS contacts for these physicians: npm run notify:contacts');
});

/** Practitioner refs ordered by how many seeded appointments they have. */
async function practitionersWithAppointments(db: ReturnType<typeof adminClient>, clinicId: string): Promise<string[]> {
  const { data, error } = await db
    .from(FHIR_RESOURCES_TABLE)
    .select('refs')
    .eq('clinic_id', clinicId)
    .eq('resource_type', 'Appointment');
  if (error) fail(`reading appointments failed (${error.code})`);
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    for (const ref of row.refs as string[]) {
      if (ref.startsWith('practitioner:')) {
        const practitioner = ref.slice('practitioner:'.length);
        counts.set(practitioner, (counts.get(practitioner) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([ref]) => ref);
}
