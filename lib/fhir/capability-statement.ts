import type { CapabilityStatement } from 'fhir/r4';
import type { Capabilities } from './provider';

/** Marks an interaction the gateway provides with Brevicor's docstore (valueCode local-only). */
export const CAPABILITY_FALLBACK_EXT = 'https://brevicor.ca/fhir/StructureDefinition/capability-fallback';
const FALLBACK_DOC =
  "Supported with fallback: this clinic's EHR can't store it, so Brevicor stores it (meta.tag https://brevicor.ca/fhir/sync-status|local-only) and includes it in reads and searches.";

/**
 * CapabilityStatement for a clinic, generated from its provider's
 * capabilities. Deliberately says nothing about which EHR sits behind it.
 */
export function capabilityStatement(caps: Capabilities, baseUrl: string, now = new Date()): CapabilityStatement {
  return {
    resourceType: 'CapabilityStatement',
    status: 'active',
    date: now.toISOString(),
    publisher: 'Brevicor',
    kind: 'instance',
    software: { name: 'Brevicor EHR Integration Layer', version: '0.1.0' },
    implementation: { description: 'Brevicor FHIR R4 API', url: baseUrl },
    fhirVersion: '4.0.1',
    format: ['application/fhir+json', 'json'],
    rest: [
      {
        mode: 'server',
        resource: caps.resources.map((r) => ({
          type: r.type,
          interaction: r.interactions.map((code) =>
            r.fallback?.includes(code)
              ? { extension: [{ url: CAPABILITY_FALLBACK_EXT, valueCode: 'local-only' }], code, documentation: FALLBACK_DOC }
              : { code },
          ),
          versioning: 'versioned',
          ...(r.interactions.includes('create') ? { conditionalCreate: true } : {}),
          searchParam: r.searchParams.map((p) => ({ name: p.name, type: p.type })),
        })),
        searchParam: [
          { name: '_count', type: 'number' },
          { name: '_offset', type: 'number' },
        ],
        // Conditional create (If-None-Exist) is evaluated by the gateway for every clinic.
      },
    ],
  };
}
