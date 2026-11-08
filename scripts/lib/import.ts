import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Bundle, FhirResource } from 'fhir/r4';
import { toRow, type FhirResourceRow } from '@/lib/fhir/providers/mock-index';
import { fail, upsertRows } from './cli';
import {
  emptyStats,
  indexProviderBundles,
  defaultCaps,
  isProviderFile,
  transformPatientBundle,
  type ClinicalCaps,
  transformProviderResources,
  type TransformStats,
} from './synthea';

export const DEFAULT_SYNTHEA_DIR = './synthea-output/fhir';
export const DEFAULT_MAX_ENCOUNTERS = 10;

/**
 * Loads Synthea FHIR output into a mock clinic. Idempotent: rows are upserted
 * by (clinic, type, id) and Synthea ids are stable UUIDs.
 */
export async function importSynthea(
  db: SupabaseClient,
  clinicId: string,
  dir: string,
  maxEncounters = DEFAULT_MAX_ENCOUNTERS,
  caps: ClinicalCaps = defaultCaps(),
): Promise<TransformStats> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  } catch {
    fail(`cannot read ${dir}: generate Synthea output first (see README)`);
  }
  const providerFiles = files.filter(isProviderFile);
  const patientFiles = files.filter((f) => !isProviderFile(f));
  if (patientFiles.length === 0) fail(`no patient bundles in ${dir}`);

  const stats = emptyStats();
  const now = new Date();
  const index = indexProviderBundles(await Promise.all(providerFiles.map((f) => readBundle(join(dir, f)))));
  const written = new Set<string>();
  let pending: FhirResourceRow[] = [];

  const flush = async () => {
    await upsertRows(db, pending);
    pending = [];
  };
  const add = async (rows: FhirResourceRow[]) => {
    for (const row of rows) {
      const key = `${row.resource_type}/${row.id}`;
      if (written.has(key)) continue; // a batch may not upsert the same row twice
      written.add(key);
      pending.push(row);
    }
    if (pending.length >= 500) await flush();
  };

  await add(transformProviderResources(index, stats).map((r) => toRow(clinicId, r, 1, now)));
  for (const [i, file] of patientFiles.entries()) {
    const bundle = await readBundle(join(dir, file));
    await add(transformPatientBundle(bundle, index, maxEncounters, stats, caps).map((r) => toRow(clinicId, r, 1, now)));
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${patientFiles.length} patient bundles`);
  }
  await flush();
  return stats;
}

async function readBundle(path: string): Promise<Bundle<FhirResource>> {
  const json = JSON.parse(await readFile(path, 'utf8')) as Bundle<FhirResource>;
  if (json.resourceType !== 'Bundle') fail(`${path} is not a FHIR Bundle`);
  return json;
}

export function printStats(stats: TransformStats): void {
  const kept = Object.entries(stats.kept)
    .map(([type, n]) => `${type}=${n}`)
    .join(' ');
  console.log(`imported: ${kept}`);
  const capped = Object.entries(stats.droppedByCap)
    .map(([type, n]) => `${type}=${n}`)
    .join(' ');
  console.log(
    `encounters dropped (cap): ${stats.droppedEncounters}; clinical dropped (caps): ${capped || 'none'}; references to non-imported resources made logical: ${stats.unresolvedReferences}; invalid skipped: ${stats.invalid}`,
  );
}
