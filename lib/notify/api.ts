import 'server-only';
import type { FhirResource } from 'fhir/r4';
import { resolveCaller, supabaseAuthDeps } from '@/lib/fhir/auth';
import { loadConnection } from '@/lib/fhir/connections';
import { CLINIC_ID_RE, handleFhirRequest } from '@/lib/fhir/gateway';
import { logInfo } from '@/lib/fhir/log';
import { FhirError, errorCode, errorResponse } from '@/lib/fhir/outcome';
import { getAdminClient } from '@/lib/supabase/admin';
import { notifyConfig, onlineWindowSeconds } from './config';
import { FhirLookupError, type FhirReader } from './fhir';
import { createChannels } from './providers';
import { parseEvent } from './request';
import { processEvent } from './service';
import { NotifyStoreError, supabaseNotifyStore } from './store';

/**
 * /api/notify/v1/*. Errors are OperationOutcomes, like the FHIR API; a failed
 * delivery is not an error (it comes back in the 200 response).
 */

const MAX_BODY_CHARS = 8_192;

/** POST /events: service callers only (INTERNAL_SERVICE_TOKEN + X-Clinic-Id). */
export function handleNotifyEvent(req: Request): Promise<Response> {
  return withLog(req, 'events', async (log) => {
    const db = getAdminClient();
    const caller = await resolveCaller(req, supabaseAuthDeps(db), (c) => {
      log.caller = c.kind;
      log.user = c.userId;
    });
    if (caller.kind !== 'service') {
      throw new FhirError(403, 'forbidden', 'Notification events are sent by server-side code with the service token');
    }
    const conn = CLINIC_ID_RE.test(caller.clinicId) ? await loadConnection(caller.clinicId) : null;
    if (!conn) throw new FhirError(404, 'not-found', 'Unknown clinic');
    log.clinic = conn.clinicId;

    const config = notifyConfig();
    const input = parseEvent(await readJson(req), config.appBaseUrl);
    log.type = input.type;
    const result = await processEvent(conn.clinicId, input, {
      store: supabaseNotifyStore(db),
      fhir: gatewayReader(conn.clinicId, new URL(req.url).origin),
      channels: await createChannels(),
      config,
    });
    log.deduplicated = result.deduplicated;
    log.results = result.results.map((r) => [r.channel, r.status, r.errorCode].filter(Boolean).join(':'));
    return Response.json(result);
  });
}

/** POST /presence: a signed-in physician's heartbeat. Online physicians get no SMS for patient_waiting. */
export function handlePresence(req: Request): Promise<Response> {
  return withLog(req, 'presence', async (log) => {
    const db = getAdminClient();
    const caller = await resolveCaller(req, supabaseAuthDeps(db), (c) => {
      log.caller = c.kind;
      log.user = c.userId;
    });
    if (caller.kind !== 'user' || caller.role !== 'physician') {
      throw new FhirError(403, 'forbidden', 'Presence is recorded for signed-in physicians only');
    }
    log.clinic = caller.clinicId;
    const now = new Date();
    await supabaseNotifyStore(db).touchPresence(caller.clinicId, caller.userId, now);
    return Response.json({ lastSeenAt: now.toISOString(), onlineWindowSeconds: onlineWindowSeconds() });
  });
}

/** Reads through our own FHIR API in process: same auth (service token), tenant scoping and validation as HTTP. */
export function gatewayReader(clinicId: string, origin: string): FhirReader {
  return {
    async read<T extends FhirResource>(type: T['resourceType'], id: string): Promise<T> {
      const req = new Request(`${origin}/api/fhir/R4/${type}/${encodeURIComponent(id)}`, {
        headers: {
          Authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN ?? ''}`,
          'X-Clinic-Id': clinicId,
          Accept: 'application/fhir+json',
        },
      });
      const res = await handleFhirRequest(req, [type, id]);
      if (res.status !== 200) throw new FhirLookupError(type, res.status);
      return (await res.json()) as T;
    },
  };
}

async function readJson(req: Request): Promise<unknown> {
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) {
    throw new FhirError(415, 'not-supported', 'Content-Type must be application/json');
  }
  const text = await req.text();
  if (text.length > MAX_BODY_CHARS) throw new FhirError(413, 'too-costly', 'Request body is too large');
  try {
    return JSON.parse(text);
  } catch {
    throw new FhirError(400, 'structure', 'Request body is not valid JSON');
  }
}

/** One PHI-free line per request: route, clinic, caller, type and per-delivery status codes. No recipients, no keys. */
interface NotifyRequestLog {
  route: 'events' | 'presence';
  clinic: string | null;
  caller?: 'user' | 'service';
  user?: string;
  type?: string;
  deduplicated?: boolean;
  /** channel:status[:errorCode] per delivery. */
  results?: string[];
  status: number;
  issue?: string;
  ms: number;
}

async function withLog(req: Request, route: NotifyRequestLog['route'], body: (log: NotifyRequestLog) => Promise<Response>): Promise<Response> {
  const started = performance.now();
  const log: NotifyRequestLog = { route, clinic: null, status: 0, ms: 0 };
  let res: Response;
  try {
    if (req.method !== 'POST') throw new FhirError(405, 'not-supported', `${req.method} is not supported here; use POST`, undefined, { Allow: 'POST' });
    res = await body(log);
  } catch (err) {
    const e = err instanceof NotifyStoreError ? new FhirError(503, 'transient', 'Notifications are temporarily unavailable') : err;
    res = errorResponse(e);
    log.issue = errorCode(e);
  }
  log.status = res.status;
  log.ms = Math.round(performance.now() - started);
  logInfo('notify.request', { ...log });
  return res;
}
