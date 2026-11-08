import type { SupabaseClient } from '@supabase/supabase-js';
import { FhirError } from '../outcome';
import type { EhrConnection, EhrProvider } from '../provider';
import { MockProvider } from './mock';
import { NativeFhirProvider } from './native';

export interface ProviderDeps {
  supabase: SupabaseClient;
  fetch?: typeof fetch;
}

/** The one place that knows which kinds of EHR exist. */
export function createProvider(conn: EhrConnection, deps: ProviderDeps): EhrProvider {
  switch (conn.mode) {
    case 'mock':
      return new MockProvider(deps.supabase, conn.clinicId);
    case 'fhir':
      return new NativeFhirProvider(conn, deps.fetch);
    case 'adapter':
      throw new FhirError(501, 'not-supported', "This clinic's EHR adapter is not available yet");
  }
}
