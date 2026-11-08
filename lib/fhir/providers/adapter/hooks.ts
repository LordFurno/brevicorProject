import type { FhirResource } from 'fhir/r4';
import type { InScopeType } from '../../provider';

/**
 * Escape hatch for per-vendor logic the YAML can't express (request signing,
 * an awkward field that needs real code). A vendor opts in with `hooks: <name>`
 * in its definition. Prefer the mapping file; ClinicSoft uses no hooks.
 */
export interface VendorHooks {
  /** Adjust an outgoing vendor request: extra headers, signing, URL tweaks. */
  beforeRequest?(request: { url: URL; headers: Headers }, ctx: { type: InScopeType }): void | Promise<void>;
  /** Patch a mapped resource before it is validated. `record` is the raw vendor JSON. */
  afterMap?(resource: FhirResource, record: unknown, ctx: { type: InScopeType }): FhirResource | Promise<FhirResource>;
}

export const VENDOR_HOOKS: Record<string, VendorHooks> = {};
