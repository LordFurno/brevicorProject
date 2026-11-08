import 'server-only';
import { getAdminClient } from '@/lib/supabase/admin';
import { resolveCaller, supabaseAuthDeps } from './auth';
import { loadConnection } from './connections';
import { dispatch } from './dispatch';
import { FhirError } from './outcome';
import { createProvider } from './providers';

const CLINIC_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Entry point for /api/fhir/R4/*: caller -> clinic's EHR connection -> provider -> dispatch. */
export function handleFhirRequest(req: Request, path: string[]): Promise<Response> {
  return dispatch(
    req,
    path,
    async (identify) => {
      const db = getAdminClient();
      const caller = await resolveCaller(req, supabaseAuthDeps(db), identify);
      const conn = CLINIC_ID_RE.test(caller.clinicId) ? await loadConnection(caller.clinicId) : null;
      if (!conn) throw new FhirError(404, 'not-found', 'Unknown clinic');
      return { provider: createProvider(conn, { supabase: db }), clinicId: conn.clinicId };
    },
    { baseUrl: `${new URL(req.url).origin}/api/fhir/R4` },
  );
}
