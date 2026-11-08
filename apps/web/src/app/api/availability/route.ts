import { getPractitioner } from '@/lib/directory';
import { json, jsonError } from '@/lib/http';
import { getMonthAvailability } from '@/lib/visits/service';

export const dynamic = 'force-dynamic';

// GET /api/availability?practitionerId=pr-chen&month=2026-11
export async function GET(req: Request) {
  const url = new URL(req.url);
  const practitioner = getPractitioner(url.searchParams.get('practitionerId') ?? '');
  const month = url.searchParams.get('month') ?? '';
  if (!practitioner) return jsonError(404, 'Physician not found');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return jsonError(400, 'month must be YYYY-MM');
  return json({ days: await getMonthAvailability(practitioner, month) });
}
