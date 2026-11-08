import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  logging: {
    // FHIR search URLs carry patient data (?family=, ?birthdate=). The gateway
    // writes its own PHI-free log line (lib/fhir/log.ts) instead.
    incomingRequests: { ignore: [/^\/api\/fhir\//] },
  },
};

export default nextConfig;
