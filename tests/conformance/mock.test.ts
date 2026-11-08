import { createClient } from '@supabase/supabase-js';
import { describe, it } from 'vitest';
import { FHIR_RESOURCES_TABLE, MockProvider } from '@/lib/fhir/providers/mock';
import { toRow } from '@/lib/fhir/providers/mock-index';
import { FIXTURES } from './fixtures';
import { runProviderContract } from './provider-contract';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;

if (!url || !key) {
  describe.skip('provider contract: mock (SUPABASE_URL / SUPABASE_SECRET_KEY not set)', () => {
    it('skipped', () => {});
  });
} else {
  runProviderContract({
    name: 'mock (Supabase)',
    async setup() {
      const db = createClient(url, key, { auth: { persistSession: false } });
      // A throwaway clinic, so tests never touch demo data and clean up with one delete.
      const clinicId = `cf-${crypto.randomUUID().slice(0, 8)}`;
      const conn = await db.from('ehr_connections').insert({ clinic_id: clinicId, name: 'Contract test', mode: 'mock' });
      if (conn.error) throw new Error(`creating test clinic failed: ${conn.error.message}`);
      const now = new Date();
      const rows = await db.from(FHIR_RESOURCES_TABLE).insert(FIXTURES.map((r) => toRow(clinicId, r, 1, now)));
      if (rows.error) throw new Error(`loading fixtures failed: ${rows.error.message}`);

      return {
        provider: new MockProvider(db, clinicId),
        async teardown() {
          // fhir_resources rows go with it (on delete cascade).
          await db.from('ehr_connections').delete().eq('clinic_id', clinicId);
        },
      };
    },
  });
}
