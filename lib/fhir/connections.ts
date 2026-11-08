import 'server-only';
import { getAdminClient } from '@/lib/supabase/admin';
import { FhirError } from './outcome';
import type { ConnectionAuth, ConnectionMode, EhrConnection } from './provider';

const TTL_MS = 60_000;
const cache = new Map<string, { expires: number; conn: EhrConnection | null }>();

interface ConnectionRow {
  clinic_id: string;
  name: string;
  mode: ConnectionMode;
  base_url: string | null;
  auth: unknown;
  adapter_config: unknown;
  read_only: boolean;
}

/** The clinic's ehr_connections row, or null if there is none. Cached briefly. */
export async function loadConnection(clinicId: string): Promise<EhrConnection | null> {
  const hit = cache.get(clinicId);
  if (hit && hit.expires > Date.now()) return hit.conn;

  const { data, error } = await getAdminClient()
    .from('ehr_connections')
    .select('clinic_id, name, mode, base_url, auth, adapter_config, read_only')
    .eq('clinic_id', clinicId)
    .maybeSingle<ConnectionRow>();
  if (error) throw new FhirError(503, 'transient', 'Clinic configuration is temporarily unavailable');

  const conn = data ? toConnection(data) : null;
  cache.set(clinicId, { expires: Date.now() + TTL_MS, conn });
  return conn;
}

function toConnection(row: ConnectionRow): EhrConnection {
  return {
    clinicId: row.clinic_id,
    name: row.name,
    mode: row.mode,
    baseUrl: row.base_url,
    auth: parseAuth(row.auth),
    adapterConfig: row.adapter_config,
    readOnly: row.read_only,
  };
}

function parseAuth(auth: unknown): ConnectionAuth {
  const a = (auth ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : undefined);
  if (a.type === 'bearer' && str('tokenEnv')) return { type: 'bearer', tokenEnv: str('tokenEnv')! };
  if (a.type === 'apiKey' && str('keyEnv')) return { type: 'apiKey', keyEnv: str('keyEnv')! };
  if (a.type === 'oauth2_client_credentials' && str('clientIdEnv') && str('clientSecretEnv')) {
    return { type: 'oauth2_client_credentials', clientIdEnv: str('clientIdEnv')!, clientSecretEnv: str('clientSecretEnv')! };
  }
  return { type: 'none' };
}
