import { handleNotifyEvent } from '@/lib/notify/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Other methods are routed too, so they get a 405 OperationOutcome rather than a bare 405.
export { handleNotifyEvent as POST, handleNotifyEvent as GET, handleNotifyEvent as PUT, handleNotifyEvent as DELETE, handleNotifyEvent as PATCH };
