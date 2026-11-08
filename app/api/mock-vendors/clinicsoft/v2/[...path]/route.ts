import { getAdminClient } from '@/lib/supabase/admin';
import { handleClinicSoftRequest } from '@/lib/vendors/clinicsoft/api';

// The fake ClinicSoft EMR API (see lib/vendors/clinicsoft/api.ts). Not part of
// the FHIR gateway: the adapter calls it over HTTP like any vendor.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };

export async function GET(req: Request, ctx: Context): Promise<Response> {
  const { path } = await ctx.params;
  return handleClinicSoftRequest(req, path, { db: getAdminClient(), apiKey: process.env.CLINICSOFT_API_KEY });
}
