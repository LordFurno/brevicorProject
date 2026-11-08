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
  Notification channels sit behind `NotificationChannel` (`lib/notify/providers/`).
  No Twilio imports outside `apps/web/src/comms/twilio/` and `lib/notify/providers/`
  (a unit test enforces the root-app side).
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
- Tenant and role come from the verified caller (`resolveCaller()` in
  `lib/fhir/auth.ts`), never from a header or request body alone. Physicians
  and staff send a Supabase access token, and their clinic comes from
  `clinic_members`. `X-Clinic-Id` only *selects* among clinics they belong to.
  Server-side code sends `INTERNAL_SERVICE_TOKEN` plus `X-Clinic-Id`. Patients
  never call the FHIR API. Every DB query is scoped by tenant.
- All errors are FHIR `OperationOutcome` resources (`lib/fhir/outcome.ts`):
  providers throw `FhirError`, and `lib/fhir/dispatch.ts` turns it into a response.
- Validate resources against FHIR R4 on the way in and on the way out
  (`lib/fhir/validate.ts`).
- Unsupported operations return an `OperationOutcome`. Never silently drop
  a write. If an EHR can't create an Encounter or DocumentReference, the
  gateway stores it in the Brevicor docstore (`fhir_docstore`, via
  `FallbackProvider` in `lib/fhir/providers/fallback.ts`, which
  `createProvider()` wraps around every provider), tagged
  `https://brevicor.ca/fhir/sync-status|local-only`, merged into reads and
  searches, and reported in `/metadata` as supported-with-fallback.
- Non-FHIR EHRs are described by a vendor definition (`vendors/<name>.yaml`:
  request templates + JSONata maps) run by the adapter engine in
  `lib/fhir/providers/adapter/`. Add vendors with YAML, not code. A vendor
  can't express a search → 400, never a silently wider query. Mapping failures
  → 502 naming vendor + type, never values. See `docs/adapter-guide.md`.
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
app/api/fhir/R4/[...path]/route.ts, lib/fhir/{gateway,auth,dispatch,provider,search,validate,bundle,
capability-statement,outcome,log,connections,identifiers}.ts, lib/fhir/providers/{index,mock,mock-index,native,http,fallback}.ts,
lib/fhir/providers/adapter/, vendors/*.yaml, lib/vendors/clinicsoft/ (fake EMR API,
app/api/mock-vendors/clinicsoft/v2/), lib/supabase/admin.ts,
scripts/{import-synthea,load-clinicsoft,seed-appointments,reset,seed-users,token}.ts (+ scripts/lib/),
supabase/migrations/, tests/{unit,golden,integration,conformance}/

## Commands
- Dev: `npm run dev`
- Test (unit): `npm run test:unit`
- Test (conformance vs mock): `npm run test:conformance`
- Test (conformance vs HAPI): `docker run -d -p 8080:8080 hapiproject/hapi:latest`, then
  `HAPI_FHIR_URL=http://localhost:8080/fhir npm run test:conformance`
- Seed / reset demo data: `npm run fhir:seed -- demo-mock` / `npm run fhir:reset -- demo-mock`
  (both also write the same appointment plan to ClinicSoft practice `demo`;
  `npm run clinicsoft:load` reloads ClinicSoft from Synthea CSV)
- Demo logins: `npm run fhir:users`, then `TOKEN=$(npm run -s fhir:token -- physician.one@demo.brevicor.test)`
# Notification service

Physician alerts and patient invitations at `/api/notify/v1` (root app). Spec:
`docs/specs.md` (Physician Notifications, Appointment Management). Details,
setup and the wired frontend calls: `docs/notifications.md`.

## Rules
- Templates (`lib/notify/templates.ts`) accept only clinic display name,
  appointment time, modality and link. Never add a field for a name, reason,
  DOB or contact. SMS text stays GSM-7 and fits 160 characters.
- Patient contacts come only from FHIR `Patient.telecom` (read through the
  gateway with the service token, `gatewayReader` in `lib/notify/api.ts`).
  The events API rejects contact details in the request. No fallback.
- `POST /events` is for service callers only; `POST /presence` for signed-in physicians.
  Both use `resolveCaller()`. Errors are OperationOutcomes; failed deliveries
  are 200 results, never thrown.
- `notification_log` never stores bodies or full recipients: `recipient_masked`
  for people, `recipient_key` (HMAC, `lib/notify/config.ts`) for dedupe and
  rate limits. Unique per (clinic, dedupe_key, channel, recipient_key); the
  row is claimed (`sending`) before the provider is called.
- Providers throw `DeliveryError(code, detail)` with our own detail text, never
  the provider's message (Twilio's include phone numbers). New provider = one
  file in `lib/notify/providers/` + one registry entry + one env value.
- Tests force `NOTIFY_*_PROVIDER=console` (`tests/setup.ts`). Never send real
  messages from tests.
- Twilio trial accounts reject custom text (572006). `TWILIO_TRIAL_TEMPLATES=true`
  sends Twilio's predefined templates instead (provider `twilio-trial`). Trial demos only.

## Layout
app/api/notify/v1/{events,presence}/route.ts, lib/notify/{api,service,templates,store,request,config,phone,fhir,types}.ts,
lib/notify/providers/{index,types,console,twilio-sms,twilio-errors}.ts, lib/fhir/modality.ts,
scripts/{seed-contacts,notify-test}.ts, supabase/migrations/20261110000000_notifications.sql

## Commands
- Physician SMS contacts: `npm run notify:contacts` (after `fhir:users`; uses `DEMO_PHYSICIAN_PHONE`)
- Real end-to-end send (needs `npm run dev`): `npm run notify:test -- <patient_waiting|visit_invitation|visit_cancelled|visit_rescheduled> [--clinic demo-mock] [--dedupe-key k]`

# Persistent Brevicor memory (apps/web)

- Clinical data remains authoritative in the EHR. `visits` stores Appointment,
  Patient and Practitioner references, scheduling copies and communication state.
  Never add patient demographics, full FHIR resources, or raw invitation tokens.
- `visit_events` is the timeline and audit trail. State changes and events commit
  together through server-only compare-and-swap RPCs. Metadata contains only
  allowed state values, timestamps, photo IDs and notification result codes.
- `visit_photos` stores Cloudinary references, notes and diagnosis; history uses
  `(clinic_id, patient_ref)`, never a name+DOB hash. A physician's assigned visit
  authorizes clinic-wide history for that patient. Patients access only their visit.
- Every memory query is clinic-scoped, RLS is enabled, and anon/authenticated have
  no memory-table or RPC grants. `SUPABASE_SECRET_KEY` is server-only. Never fall
  back to an in-memory store on a database error.
- Physician Auth uses the same Supabase users and `clinic_members` as the gateway.
  Forward their token for clinical reads and presence. Sync, DOB verification and
  notifications use `INTERNAL_SERVICE_TOKEN` plus explicit clinic context.
- Invitation hashes are SHA-256. Rotation requires fresh DOB verification; a
  separate signed credential lets an already joined call finish. Appointment
  cancellation is tracked independently from communication status. Ending a call
  never completes the EHR Encounter.
- `BOOKING_ENABLED=false` by default. The retained booking preview additionally
  requires development + `VISIT_STORE=memory`; it never writes to Supabase.
- Dashboard entry and explicit sync refresh today plus 14 days. Polls read the DB.
  Re-sync never rebuilds EHR data or deletes history. Demo rebuilding remains the
  root `fhir:reset` command, followed by frontend sync.

Layout: `apps/web/src/lib/{visits,auth,clinical,supabase}/`,
`apps/web/src/lib/notify.ts`, `apps/web/src/media/visit-photos.ts`,
`apps/web/scripts/{sync-visits,verify-memory-flow}.ts`,
`supabase/migrations/20261111*_memory*.sql` (schema and locked photo authorization).

Commands (in apps/web): `npm run visits:sync -- <clinicId>`, `npm test`,
`npm run typecheck`, `npm run build`. Setup and demo: `apps/web/README.md`.
