import { json, jsonError, readJson } from '@/lib/http';
import { createBooking } from '@/lib/visits/service';

// POST /api/bookings — public, no account. Returns the secret invite token once.
export async function POST(req: Request) {
  const result = await createBooking(await readJson(req));
  if (!result.ok) return jsonError(result.status, result.error);
  return json({ visitId: result.value.id, token: result.value.inviteToken }, 201);
}
