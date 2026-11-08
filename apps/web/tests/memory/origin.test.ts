import { afterEach, describe, expect, it, vi } from 'vitest';
import { wrongOrigin } from '@/lib/http';

const req = (origin?: string) =>
  new Request('http://localhost:3000/api/bookings', {
    method: 'POST',
    headers: origin === undefined ? {} : { origin },
  });

describe('wrongOrigin', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('accepts requests without an Origin header and from the server origin', () => {
    vi.stubEnv('APP_BASE_URL', '');
    expect(wrongOrigin(req())).toBe(false);
    expect(wrongOrigin(req('http://localhost:3000'))).toBe(false);
  });

  it('accepts the public APP_BASE_URL origin behind a tunnel or proxy', () => {
    vi.stubEnv('APP_BASE_URL', ' https://clinic.example.trycloudflare.com/ ');
    expect(wrongOrigin(req('https://clinic.example.trycloudflare.com'))).toBe(false);
  });

  it('rejects other sites', () => {
    vi.stubEnv('APP_BASE_URL', 'https://clinic.example.trycloudflare.com');
    expect(wrongOrigin(req('https://evil.example'))).toBe(true);
    expect(wrongOrigin(req('http://clinic.example.trycloudflare.com'))).toBe(true);
    expect(wrongOrigin(req('null'))).toBe(true);
    vi.stubEnv('APP_BASE_URL', 'not a url');
    expect(wrongOrigin(req('https://evil.example'))).toBe(true);
  });
});
