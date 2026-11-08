import type { FhirResource } from 'fhir/r4';

/** What the notification service needs from the clinic's chart (implemented in lib/notify/api.ts). */
export interface FhirReader {
  /** Throws FhirLookupError on any non-200. */
  read<T extends FhirResource>(type: T['resourceType'], id: string): Promise<T>;
}

export class FhirLookupError extends Error {
  constructor(
    readonly resourceType: string,
    readonly status: number,
  ) {
    super(`FHIR read of ${resourceType} failed (${status})`);
    this.name = 'FhirLookupError';
  }
}
