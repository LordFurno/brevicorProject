import { describe, it } from 'vitest';
import { NativeFhirProvider } from '@/lib/fhir/providers/native';
import { FIXTURES } from './fixtures';
import { runProviderContract } from './provider-contract';

/**
 * Runs the contract against a real FHIR server standing in for a native EHR:
 *   docker run -d -p 8080:8080 hapiproject/hapi:latest
 *   HAPI_FHIR_URL=http://localhost:8080/fhir npm run test:conformance
 * Never point this at a shared server: it writes fixtures.
 */
const base = process.env.HAPI_FHIR_URL?.replace(/\/+$/, '');

if (!base) {
  describe.skip('provider contract: native FHIR (HAPI_FHIR_URL not set)', () => {
    it('skipped', () => {});
  });
} else {
  runProviderContract({
    name: `native FHIR (${base})`,
    async setup() {
      // FIXTURES are ordered so referenced resources exist first (HAPI enforces referential integrity).
      for (const resource of FIXTURES) {
        const res = await fetch(`${base}/${resource.resourceType}/${resource.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/fhir+json' },
          body: JSON.stringify(resource),
        });
        if (!res.ok) throw new Error(`loading ${resource.resourceType}/${resource.id} failed: HTTP ${res.status}`);
      }
      const provider = new NativeFhirProvider({
        clinicId: 'contract-hapi',
        name: 'HAPI (contract)',
        mode: 'fhir',
        baseUrl: base,
        auth: { type: 'none' },
        adapterConfig: null,
        readOnly: false,
      });
      return {
        provider,
        async teardown(created) {
          // Delete what the write tests made, newest first so references don't block deletes.
          for (const ref of [...created].reverse()) {
            await fetch(`${base}/${ref}`, { method: 'DELETE' });
          }
        },
      };
    },
  });
}
