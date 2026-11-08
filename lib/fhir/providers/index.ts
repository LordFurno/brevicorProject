import type { SupabaseClient } from '@supabase/supabase-js';
import type { EhrConnection, EhrProvider } from '../provider';
import { AdapterProvider } from './adapter';
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
      return new AdapterProvider(conn, { fetch: deps.fetch });
  }
}
