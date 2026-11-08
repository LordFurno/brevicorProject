# Brevicor Telemedicine

## What this is
A browser-based telemedicine module for Ontario clinics. Physicians start video
or phone consultations from scheduled appointments; patients join via a secure
link (no account, no app). Consultations are transcribed and filed to the
patient's chart.

The core deliverable is the **FHIR R4 EHR Integration Layer**: one standard
FHIR API that works with any clinic's EHR (native FHIR, proprietary adapter,
or mock). The telemedicine module is the working demo that proves it.

Full spec: `docs/specs.md`. Read the relevant section before building a feature.

## Hard rules
- The telemedicine module talks to clinical data ONLY through the FHIR R4 API
  (`/api/fhir/R4`). Never call an EHR or its database directly.
- All EHR-specific logic lives in `lib/fhir/providers/` (mock, native, adapters).
  Each provider implements the same `EhrProvider` interface.
- Video/phone and transcription providers sit behind interfaces
  (`CommsProvider`, `TranscriptionProvider`), selected in `config/providers.ts`.
  No Twilio imports outside `src/comms/twilio/`.
- No patient-identifying info in logs, emails, SMS, or realtime messages.
- Every query is scoped by `tenant_id` (clinic). No cross-tenant access.
- Errors from the FHIR API are returned as FHIR `OperationOutcome` resources.
- Ending a call never marks the FHIR Encounter as completed.
- Transcripts are "unverified" until a physician reviews them.
- Raw audio is deleted after transcription.

## Stack
- Next.js + React + TypeScript, hosted on Vercel (region: yul1, Montréal)
- Supabase (ca-central-1): Postgres, Auth (physicians), Storage, Realtime
- Twilio Video + Voice (swappable)
- Transcription: AWS Transcribe Medical, ca-central-1 (swappable)
- FHIR types: `@types/fhir`

## Data residency
All stored data (database, files, transcripts, logs) must stay in Canada.
Don't add a new service that stores data without checking its region.

## Build order
1. Mock FHIR provider + integration layer (seed/reset scripts, CapabilityStatement)
2. Session backend (sessions, invitations, patient verification)
3. Video consultation + waiting room
4. Phone consultation
5. Transcription pipeline

## Commands
- Dev: `npm run dev`
- Test: `npm test` (unit + conformance), `npm run typecheck`
- Apply migrations: `npm run db:push` (Supabase CLI v3 needs `--remote`; the script passes it)
- Seed mock data: `npm run fhir:import -- demo-mock ./synthea-output/fhir`, then `npm run fhir:seed -- demo-mock`
- Reset mock data: `npm run fhir:reset -- demo-mock`

# FHIR Gateway (EHR Integration Layer)

A standalone HL7 FHIR R4 REST API at `/api/fhir/R4`. Callers see one consistent
FHIR interface no matter which EHR sits behind it. Spec: `docs/specs.md`
sections 2.1 and 4H. Contract with the app: `docs/fhir-contract.md`.

## Rules
- Every provider (mock, native, adapters) implements `EhrProvider`
  (`lib/fhir/provider.ts`). EHR-specific code lives only in
  `lib/fhir/providers/`, and `createProvider()` in `lib/fhir/providers/index.ts`
  is the only place that switches on mode. Nothing else knows which EHR is in use.
- The mock provider follows the exact same contract as real providers.
  No mock-only behaviour.
- Tenant and role come from the verified caller token, never from a header or
  request body. Every DB query is scoped by tenant. **Current exception:** the
  clinic is read from `X-Clinic-Id` as a temporary stand-in, isolated in
  `clinicIdFromRequest()` (`lib/fhir/gateway.ts`, marked `TODO(auth)`). Replace
  that function when physician auth lands.
- All errors are FHIR `OperationOutcome` resources (`lib/fhir/outcome.ts`):
  providers throw `FhirError`, and `lib/fhir/dispatch.ts` turns it into a response.
- Validate resources against FHIR R4 on the way in and on the way out
  (`lib/fhir/validate.ts`).
- Unsupported operations return an `OperationOutcome`. Never silently drop
  a write. If an EHR can't store a document, use a Brevicor docstore (not
  built yet) and record sync status and where the authoritative copy lives.
- Mock search uses columns derived from each resource (`refs`, `tokens`,
  `strings`, `date_lo/hi`), and `lib/fhir/providers/mock-index.ts` owns both
  sides of that mapping. Write rows only via `toRow()`.
- Never log resource contents or search values (`lib/fhir/log.ts`).
- `GET /metadata` (CapabilityStatement) must reflect what the tenant's
  provider actually supports.
- Use FHIR R4 field names and docs (hl7.org/fhir/R4/), not R5.

## Testing
- `tests/conformance/provider-contract.ts` is one suite that every provider
  must pass. Run it against the mock and against HAPI FHIR in Docker
  (native stand-in).
- A new provider or endpoint isn't done until conformance passes.

## Layout
app/api/fhir/R4/[...path]/route.ts, lib/fhir/{gateway,dispatch,provider,search,validate,bundle,
capability-statement,outcome,log,connections}.ts, lib/fhir/providers/{index,mock,mock-index,native}.ts,
lib/supabase/admin.ts, scripts/{import-synthea,seed-appointments,reset}.ts (+ scripts/lib/),
supabase/migrations/, tests/{unit,conformance}/

## Commands
- Dev: `npm run dev`
- Test (unit): `npm run test:unit`
- Test (conformance vs mock): `npm run test:conformance`
- Test (conformance vs HAPI): `docker run -d -p 8080:8080 hapiproject/hapi:latest`, then
  `HAPI_FHIR_URL=http://localhost:8080/fhir npm run test:conformance`
- Seed / reset mock data: `npm run fhir:seed -- demo-mock` / `npm run fhir:reset -- demo-mock`