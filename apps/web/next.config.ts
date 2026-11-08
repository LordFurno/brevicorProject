import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // This app is self-contained in apps/web; the repo root is the separate FHIR gateway app.
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ['twilio'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Visit links carry a secret token in the URL — never leak it via Referer.
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
