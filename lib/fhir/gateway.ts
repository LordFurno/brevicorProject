import 'server-only';
import { getAdminClient } from '@/lib/supabase/admin';
import { loadConnection } from './connections';
import { dispatch } from './dispatch';
import { FhirError } from './outcome';
import { createProvider } from './providers';

const CLINIC_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * TODO(auth): temporary stand-in for authentication. CLAUDE.md requires the
 * clinic (tenant) to come from the verified caller token, never a header.
 * When physician auth lands, replace this function and nothing else.
 */
export function clinicIdFromRequest(req: Request): string | null {
  const value = req.headers.get('x-clinic-id')?.trim();
  return value ? value : null;
}

/** Entry point for /api/fhir/R4/*: clinic -> EHR connection -> provider -> dispatch. */
export function handleFhirRequest(req: Request, path: string[]): Promise<Response> {
  const clinicId = clinicIdFromRequest(req);
  const knownFormat = clinicId !== null && CLINIC_ID_RE.test(clinicId);

  return dispatch(
    req,
    path,
    async () => {
      if (!clinicId) throw new FhirError(401, 'login', 'Missing clinic credentials (X-Clinic-Id)');
      const conn = knownFormat ? await loadConnection(clinicId) : null;
      if (!conn) throw new FhirError(404, 'not-found', 'Unknown clinic');
      return createProvider(conn, { supabase: getAdminClient() });
    },
    { baseUrl: `${new URL(req.url).origin}/api/fhir/R4`, clinicId: knownFormat ? clinicId : null },
  );
}
