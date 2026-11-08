import { afterEach, describe, it, expect, vi } from 'vitest';
import { gatewaySearch, gatewayRead } from '../../src/lib/clinical/gateway';
afterEach(() => vi.restoreAllMocks());
describe('gateway client', () => {
  it('follows all pages with physician credentials and the selected clinic', async () => {
    vi.stubEnv('FHIR_BASE_URL', 'http://gateway.test/api/fhir/R4');
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({
          resourceType: 'Bundle',
          type: 'searchset',
          entry: [{ resource: { resourceType: 'Patient', id: 'one' } }],
          link: [{ relation: 'next', url: 'http://gateway.test/api/fhir/R4/Patient?_offset=1' }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          resourceType: 'Bundle',
          type: 'searchset',
          entry: [{ resource: { resourceType: 'Patient', id: 'two' } }],
        }),
      );
    expect(
      await gatewaySearch('Patient', { clinicId: 'clinic-a', accessToken: 'physician-token' }),
    ).toHaveLength(2);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      cache: 'no-store',
      headers: { Authorization: 'Bearer physician-token', 'X-Clinic-Id': 'clinic-a' },
    });
  });
  it('uses the internal token only for service contexts and refuses foreign pagination origins', async () => {
    vi.stubEnv('FHIR_BASE_URL', 'http://gateway.test/api/fhir/R4');
    vi.stubEnv('INTERNAL_SERVICE_TOKEN', 'internal-token');
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({
          resourceType: 'Bundle',
          type: 'searchset',
          link: [{ relation: 'next', url: 'https://foreign.test/Patient' }],
        }),
      );
    await expect(gatewaySearch('Patient', { clinicId: 'clinic-a' })).rejects.toThrow(
      'Invalid gateway URL',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: 'Bearer internal-token' },
    });
  });
  it('does not silently accept incomplete search results or echo identifiers on errors', async () => {
    vi.stubEnv('FHIR_BASE_URL', 'http://gateway.test/api/fhir/R4');
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({
          resourceType: 'Bundle',
          type: 'searchset',
          entry: [{ search: { mode: 'outcome' }, resource: { resourceType: 'OperationOutcome' } }],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 502 }));
    await expect(
      gatewaySearch('Patient', { clinicId: 'clinic-a', accessToken: 'token' }),
    ).rejects.toThrow('incomplete');
    await expect(
      gatewayRead('Patient/private-id', { clinicId: 'clinic-a', accessToken: 'token' }),
    ).rejects.toThrow('Gateway unavailable (502)');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
