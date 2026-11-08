import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  logging: {
    // FHIR and vendor search URLs carry patient data (?family=, ?birthdate=,
    // ?lastName=, ?dob=). The gateway writes its own PHI-free log line
    // (lib/fhir/log.ts) instead.
    incomingRequests: { ignore: [/^\/api\/fhir\//, /^\/api\/mock-vendors\//] },
  },
  // Adapter vendor definitions are read from disk at runtime.
  outputFileTracingIncludes: {
    '/api/fhir/R4/[...path]': ['./vendors/**/*'],
  },
};

export default nextConfig;
