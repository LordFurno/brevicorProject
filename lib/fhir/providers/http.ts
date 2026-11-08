import { FhirError } from '../outcome';

/** Shared HTTP plumbing for providers that call an EHR over the network (native, adapter). */

export interface JsonResponse {
  status: number;
  ok: boolean;
  /** Parsed JSON, or undefined if the body wasn't JSON. */
  body: unknown;
}

/** fetch with a timeout; network failures -> 502, timeouts -> 504. Never says which EHR. */
export async function fetchJson(fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<JsonResponse> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new FhirError(504, 'timeout', 'The EHR did not respond in time');
    }
    throw new FhirError(502, 'transient', 'The EHR could not be reached');
  }
  const body: unknown = await res.json().catch(() => undefined);
  return { status: res.status, ok: res.ok, body };
}

/** How every EHR integration maps upstream failures it doesn't handle specially. */
export function upstreamFailure(status: number): FhirError {
  switch (status) {
    case 401:
    case 403:
      return new FhirError(502, 'security', "The EHR rejected the gateway's credentials");
    case 404:
      return new FhirError(404, 'not-found', 'Resource is not known');
    case 410:
      return new FhirError(410, 'deleted', 'Resource has been deleted');
    case 405:
    case 501:
      return new FhirError(501, 'not-supported', 'The EHR does not support this operation');
    case 429:
      return new FhirError(503, 'throttled', 'The EHR is rate limiting requests; retry later');
    default:
      return new FhirError(502, 'transient', 'The EHR returned an error');
  }
}
