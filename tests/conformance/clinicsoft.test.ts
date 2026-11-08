import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { describe, it, vi } from 'vitest';
import { createProvider } from '@/lib/fhir/providers';
import { handleClinicSoftRequest } from '@/lib/vendors/clinicsoft/api';
import { CLINICSOFT_SCHEMA } from '@/lib/vendors/clinicsoft/rows';
import { clinicSoftFixtureRows } from './clinicsoft-fixtures';
import { FIXTURES, LICENCE, MRN } from './fixtures';
import { runProviderContract } from './provider-contract';

/**
 * The unchanged provider contract against the YAML-driven adapter, talking to
 * the fake ClinicSoft API in-process (same handler as the HTTP route) with the
 * fixtures loaded into a throwaway ClinicSoft practice. Built through
 * createProvider(), so ClinicSoft's missing writes go to the Brevicor docstore
 * (a throwaway clinic row scopes them) exactly as in production.
 */
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;

if (!url || !key) {
  describe.skip('provider contract: adapter ClinicSoft (SUPABASE_URL / SUPABASE_SECRET_KEY not set)', () => {
    it('skipped', () => {});
  });
} else {
  runProviderContract({
    name: 'adapter: ClinicSoft (vendors/clinicsoft.yaml)',
    async setup() {
      const db = createClient(url, key, { auth: { persistSession: false } });
      const cs = db.schema(CLINICSOFT_SCHEMA);
      const practice = `cf-${randomUUID().slice(0, 8)}`;
      const clinicId = `${practice}-cs`;
      const apiKey = randomBytes(24).toString('base64url');
      vi.stubEnv('CLINICSOFT_CONFORMANCE_KEY', apiKey);

      const created = await cs.from('practices').insert({ practice_id: practice, name: 'Contract test' });
      if (created.error) {
        throw new Error(`creating ClinicSoft practice failed (${created.error.code}): is the clinicsoft schema exposed in Data API settings?`);
      }
      const conn = await db.from('ehr_connections').insert({ clinic_id: clinicId, name: 'Contract test (ClinicSoft)', mode: 'adapter' });
      if (conn.error) throw new Error(`creating test clinic failed: ${conn.error.message}`);
      const rows = clinicSoftFixtureRows(practice, FIXTURES);
      for (const [table, data] of Object.entries(rows)) {
        const { error } = await cs.from(table).insert(data as object[]);
        if (error) throw new Error(`loading clinicsoft.${table} failed: ${error.message}`);
      }

      // Route the adapter's HTTP calls straight into the fake vendor's handler.
      const vendorFetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const u = new URL(String(input));
        const path = u.pathname.replace(/^\/api\/mock-vendors\/clinicsoft\/v2\//, '').split('/');
        return handleClinicSoftRequest(new Request(u, init), path, { db, apiKey });
      }) as typeof fetch;

      const provider = createProvider(
        {
          clinicId,
          name: 'ClinicSoft (contract)',
          mode: 'adapter',
          baseUrl: null,
          auth: { type: 'apiKey', keyEnv: 'CLINICSOFT_CONFORMANCE_KEY' },
          adapterConfig: {
            vendor: 'clinicsoft',
            baseUrl: `http://vendor.test/api/mock-vendors/clinicsoft/v2/practices/${practice}`,
            config: { chartNoSystem: MRN, providerLicenceSystem: LICENCE, orgLicenceSystem: LICENCE },
          },
          readOnly: true,
        },
        { supabase: db, fetch: vendorFetch },
      );

      return {
        provider,
        async teardown() {
          await cs.from('practices').delete().eq('practice_id', practice); // everything else cascades
          await db.from('ehr_connections').delete().eq('clinic_id', clinicId); // docstore rows cascade
          vi.unstubAllEnvs();
        },
      };
    },
  });
}
