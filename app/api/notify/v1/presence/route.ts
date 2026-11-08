import { handlePresence } from '@/lib/notify/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Other methods are routed too, so they get a 405 OperationOutcome rather than a bare 405.
export { handlePresence as POST, handlePresence as GET, handlePresence as PUT, handlePresence as DELETE, handlePresence as PATCH };
