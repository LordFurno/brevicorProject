import { bookingEnabled, ehrBookingEnabled } from '@/lib/booking';
import { getPractitioner } from '@/lib/directory';
import { json, jsonError } from '@/lib/http';
import { getMonthAvailability } from '@/lib/visits/booking-demo';
import { ehrAvailability } from '@/lib/visits/ehr-booking';

export const dynamic = 'force-dynamic';

// GET /api/availability?practitionerId=pr-chen&month=2026-11
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('practitionerId') ?? '';
  const month = url.searchParams.get('month') ?? '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return jsonError(400, 'month must be YYYY-MM');
  if (ehrBookingEnabled()) {
    try {
      const days = await ehrAvailability(id, month);
      return days ? json({ days }) : jsonError(404, 'Physician not found');
    } catch {
      return jsonError(503, 'The clinic schedule is unavailable. Please try again.');
    }
  }
  if (!bookingEnabled()) return jsonError(404, 'Not found');
  const practitioner = getPractitioner(id);
  if (!practitioner) return jsonError(404, 'Physician not found');
  return json({ days: await getMonthAvailability(practitioner, month) });
}
