import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { FHIR_RESOURCES_TABLE } from '@/lib/fhir/providers/mock';
import type { FhirResourceRow } from '@/lib/fhir/providers/mock-index';

/** Scripts print counts and ids only, never resource contents. */

class CliError extends Error {}

export function fail(message: string): never {
  throw new CliError(message);
}

/**
 * Runs a script body, turning fail() into "error: ..." + exit code 1.
 * Avoids process.exit(), which can abort Node on Windows while fetch sockets are still closing.
 */
export async function main(body: () => Promise<void>): Promise<void> {
  try {
    loadEnv();
    await body();
  } catch (err) {
    console.error(err instanceof CliError ? `error: ${err.message}` : err);
    process.exitCode = 1;
  }
}

/** Loads .env.local once (shell variables win). main() calls it before the script body runs. */
let envLoaded = false;
export function loadEnv(): void {
  if (envLoaded) return;
  envLoaded = true;
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // fall back to the shell environment
  }
}

export function adminClient(): SupabaseClient {
  loadEnv();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) fail('SUPABASE_URL and SUPABASE_SECRET_KEY must be set (see .env.local)');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Scripts only ever write to mock clinics: a fhir/adapter clinic's data lives in its EHR. */
export async function requireMockClinic(db: SupabaseClient, clinicId: string): Promise<void> {
  const { data, error } = await db.from('ehr_connections').select('mode').eq('clinic_id', clinicId).maybeSingle();
  if (error) fail(`could not read ehr_connections (${error.code})`);
  if (!data) fail(`unknown clinic '${clinicId}': add it to ehr_connections first`);
  if (data.mode !== 'mock') fail(`clinic '${clinicId}' is mode '${data.mode}'; scripts only write to mock clinics`);
}

export async function upsertRows(db: SupabaseClient, rows: FhirResourceRow[], batchSize = 200): Promise<void> {
  for (let i = 0; i < rows.length; i += batchSize) {
    const { error } = await db
      .from(FHIR_RESOURCES_TABLE)
      .upsert(rows.slice(i, i + batchSize), { onConflict: 'clinic_id,resource_type,id' });
    if (error) fail(`upsert failed (${error.code}): ${error.message}`);
  }
}

export async function deleteResources(db: SupabaseClient, clinicId: string, resourceType?: string): Promise<void> {
  let q = db.from(FHIR_RESOURCES_TABLE).delete().eq('clinic_id', clinicId);
  if (resourceType) q = q.eq('resource_type', resourceType);
  const { error } = await q;
  if (error) fail(`delete failed (${error.code})`);
}
