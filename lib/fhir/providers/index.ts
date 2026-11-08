import type { SupabaseClient } from '@supabase/supabase-js';
import type { EhrConnection, EhrProvider, InScopeType, Interaction } from '../provider';
import { defaultTimeZone } from '../search';
import { AdapterProvider } from './adapter';
import { FallbackProvider } from './fallback';
import { FHIR_DOCSTORE_TABLE, MockProvider } from './mock';
import { NativeFhirProvider } from './native';

export interface ProviderDeps {
  supabase: SupabaseClient;
  fetch?: typeof fetch;
}

/** What Brevicor's docstore can hold for a clinic: the writes an EHR might refuse. */
export const DOCSTORE_INTERACTIONS: Partial<Record<InScopeType, Interaction[]>> = {
  Encounter: ['read', 'search-type', 'create'],
  DocumentReference: ['read', 'search-type', 'create'],
};

/** The one place that knows which kinds of EHR exist. */
export function createProvider(conn: EhrConnection, deps: ProviderDeps): EhrProvider {
  return new FallbackProvider(ehrProvider(conn, deps), docstore(conn.clinicId, deps.supabase));
}

function ehrProvider(conn: EhrConnection, deps: ProviderDeps): EhrProvider {
  switch (conn.mode) {
    case 'mock':
      return new MockProvider(deps.supabase, conn.clinicId);
    case 'fhir':
      return new NativeFhirProvider(conn, deps.fetch);
    case 'adapter':
      return new AdapterProvider(conn, { fetch: deps.fetch });
  }
}

/** Brevicor's own store for one clinic (fhir_docstore), on the mock engine. */
export function docstore(clinicId: string, supabase: SupabaseClient): MockProvider {
  return new MockProvider(supabase, clinicId, defaultTimeZone(), { table: FHIR_DOCSTORE_TABLE, interactions: DOCSTORE_INTERACTIONS });
}
