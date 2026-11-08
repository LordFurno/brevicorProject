import { bookingEnabled, ehrBookingEnabled } from '@/lib/booking';
import { json, jsonError, readJson, wrongOrigin } from '@/lib/http';
import { createBooking } from '@/lib/visits/booking-demo';
import { createEhrBooking } from '@/lib/visits/ehr-booking';

// POST /api/bookings — public, no account. Returns the secret invite token once.
export async function POST(req: Request) {
  if (wrongOrigin(req)) return jsonError(403, 'Invalid request origin');
  if (ehrBookingEnabled()) {
    try {
      const result = await createEhrBooking(await readJson(req));
      if (!result.ok) return jsonError(result.status, result.error);
      return json({ visitId: result.visitId, token: result.token }, 201);
    } catch {
      // No PHI in logs or responses.
      console.error('[booking] EHR booking failed');
      return jsonError(503, 'The clinic couldn’t take the booking right now. Please try again.');
    }
  }
  if (!bookingEnabled()) return jsonError(404, 'Not found');
  const result = await createBooking(await readJson(req));
  if (!result.ok) return jsonError(result.status, result.error);
  return json({ visitId: result.value.id, token: result.value.inviteToken }, 201);
}
