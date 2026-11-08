import { getDoctor, isDemoLoginAllowed } from '@/lib/auth/doctor';
import { json, jsonError } from '@/lib/http';
import { resetVisitStore } from '@/lib/visits/store';

// POST /api/dev/reset — re-seed demo appointments relative to "now". Demo mode only.
export async function POST() {
  if (!isDemoLoginAllowed()) return jsonError(404, 'Not found');
  if (!(await getDoctor())) return jsonError(401, 'Unauthorized');
  resetVisitStore();
  return json({ ok: true });
}
