import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  logging: {
    // FHIR and vendor search URLs carry patient data (?family=, ?birthdate=,
    // ?lastName=, ?dob=). The gateway writes its own PHI-free log line
    // (lib/fhir/log.ts) instead.
    incomingRequests: { ignore: [/^\/api\/fhir\//, /^\/api\/mock-vendors\//] },
  },
  // Adapter vendor definitions are read from disk at runtime. Notification
  // events read the chart through the gateway in process, so they need them too.
  outputFileTracingIncludes: {
    '/api/fhir/R4/[...path]': ['./vendors/**/*'],
    '/api/notify/v1/events': ['./vendors/**/*'],
  },
  // Loaded with Node's require rather than bundled (lib/notify/providers/twilio-sms.ts).
  serverExternalPackages: ['twilio'],
};

export default nextConfig;
