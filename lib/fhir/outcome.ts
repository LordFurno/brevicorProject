import type { OperationOutcome, OperationOutcomeIssue } from 'fhir/r4';

export const FHIR_JSON = 'application/fhir+json; charset=utf-8';

export type IssueCode = OperationOutcomeIssue['code'];
export type IssueSeverity = OperationOutcomeIssue['severity'];

/** The only error type providers and gateway code throw. Becomes an OperationOutcome response. */
export class FhirError extends Error {
  constructor(
    readonly status: number,
    readonly code: IssueCode,
    readonly diagnostics: string,
    readonly issues?: OperationOutcomeIssue[],
  ) {
    super(diagnostics);
    this.name = 'FhirError';
  }
}

export function issue(code: IssueCode, diagnostics: string, severity: IssueSeverity = 'error'): OperationOutcomeIssue {
  return { severity, code, diagnostics };
}

export function operationOutcome(issues: OperationOutcomeIssue[]): OperationOutcome {
  return { resourceType: 'OperationOutcome', issue: issues };
}

export function fhirJson(body: unknown, status = 200, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set('Content-Type', FHIR_JSON);
  return new Response(JSON.stringify(body), { status, headers: h });
}

/** Never leaks internals: anything that isn't a FhirError becomes a generic 500. */
export function errorResponse(err: unknown): Response {
  if (err instanceof FhirError) {
    const issues = err.issues?.length ? err.issues : [issue(err.code, err.diagnostics)];
    return fhirJson(operationOutcome(issues), err.status);
  }
  return fhirJson(operationOutcome([issue('exception', 'Internal server error')]), 500);
}

/** Primary issue code of an error, for logs. */
export function errorCode(err: unknown): IssueCode {
  return err instanceof FhirError ? err.code : 'exception';
}
