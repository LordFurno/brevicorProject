import { FhirError } from '../../outcome';
import type { ConnectionAuth } from '../../provider';
import type { VendorAuth } from './definition';

/**
 * How the adapter authenticates to a vendor. The definition says *how* (header
 * name, token URL); the clinic's connection says *which* credentials, by env
 * var name, so secrets never live in YAML or the database.
 */
export interface AuthStrategy {
  headers(): Promise<Record<string, string>>;
}

export function createAuthStrategy(vendorAuth: VendorAuth, connAuth: ConnectionAuth): AuthStrategy {
  if (vendorAuth.type === 'apiKey' && connAuth.type === 'apiKey') {
    return new ApiKeyAuth(vendorAuth.header, connAuth.keyEnv);
  }
  if (vendorAuth.type === 'oauth2_client_credentials' && connAuth.type === 'oauth2_client_credentials') {
    return new OAuth2ClientCredentials(vendorAuth.tokenUrl, connAuth.clientIdEnv, connAuth.clientSecretEnv, vendorAuth.scope);
  }
  throw new FhirError(500, 'exception', "The clinic's EHR connection is misconfigured (auth type)");
}

class ApiKeyAuth implements AuthStrategy {
  constructor(
    private readonly header: string,
    private readonly keyEnv: string,
  ) {}

  async headers(): Promise<Record<string, string>> {
    const key = process.env[this.keyEnv];
    if (!key) throw new FhirError(500, 'exception', 'EHR credentials are not configured for this clinic');
    return { [this.header]: key };
  }
}

/**
 * OAuth 2.0 client credentials (RFC 6749 §4.4). Interface only for now: a real
 * implementation POSTs grant_type=client_credentials to tokenUrl, caches the
 * access token until shortly before expires_in, and sends it as a bearer token.
 */
export class OAuth2ClientCredentials implements AuthStrategy {
  constructor(
    readonly tokenUrl: string,
    readonly clientIdEnv: string,
    readonly clientSecretEnv: string,
    readonly scope?: string,
  ) {}

  async headers(): Promise<Record<string, string>> {
    throw new FhirError(501, 'not-supported', 'OAuth2 client-credentials authentication to EHRs is not implemented yet');
  }
}
