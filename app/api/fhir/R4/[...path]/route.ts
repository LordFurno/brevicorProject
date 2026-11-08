import { handleFhirRequest } from '@/lib/fhir/gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };

async function handler(req: Request, ctx: Context): Promise<Response> {
  const { path } = await ctx.params;
  return handleFhirRequest(req, path);
}

// DELETE and PATCH are routed too, so they get a 501 OperationOutcome rather than a bare 405.
export { handler as GET, handler as POST, handler as PUT, handler as DELETE, handler as PATCH };
