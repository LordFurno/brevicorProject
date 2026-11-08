import type { CapabilityStatement } from 'fhir/r4';
import type { Capabilities } from './provider';

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
          interaction: r.interactions.map((code) => ({ code })),
          versioning: 'versioned',
          searchParam: r.searchParams.map((p) => ({ name: p.name, type: p.type })),
        })),
        searchParam: [
          { name: '_count', type: 'number' },
          { name: '_offset', type: 'number' },
        ],
      },
    ],
  };
}
