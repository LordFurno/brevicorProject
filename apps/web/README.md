# Brevicor Web

Patient invitations, waiting room, physician dashboard, video calls, and photo history.
This is the Next 15 frontend; the Next 16 application at the repository root serves
FHIR and notifications. Install dependencies separately in each application.

## Setup

From the root, apply migrations with `npm run db:push`. In `apps/web`, run
`npm ci`, copy `.env.example` to `.env.local`, and configure the same Supabase
project used by the gateway. Environment files are ignored by Git.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Shared Supabase project URL. |
| `SUPABASE_ANON_KEY` | Publishable or legacy anon key for the cookie-backed physician Auth client. |
| `SUPABASE_SECRET_KEY` | Server-only memory database access. Never exposed in browser code. |
| `SESSION_SECRET` | Long random secret for patient and active-call cookies; identical across frontend instances. |
| `FHIR_BASE_URL` | Root gateway, normally `http://localhost:4000/api/fhir/R4`. |
| `NOTIFY_API_URL` | Root notification API, normally `http://localhost:4000/api/notify/v1`. |
| `INTERNAL_SERVICE_TOKEN` | Same secret as the root; used for sync, patient verification and notification events. |
| `APP_BASE_URL` | Canonical frontend URL. Must exactly match the root setting, including port. |
| `CRON_SECRET` | Bearer credential for the future cron integration. |
| `VISIT_STORE` | `supabase` by default. `memory` is restricted to development/tests. |
| `BOOKING_ENABLED` | `false` by default. Development booking additionally requires `VISIT_STORE=memory`. |
| `CLINICAL_SOURCE` | `fhir` by default. `mock` is limited to the development booking environment. |

The previous global `FHIR_CLINIC_ID` and service-token `FHIR_API_KEY` settings are
replaced by selected clinic membership and `INTERNAL_SERVICE_TOKEN`. Physicians'
clinical requests forward their own Supabase access token. Patient and background
requests use the service token with an explicit clinic.

Run the root with `npm run dev -- -p 4000`; run this frontend with `npm run dev`
on the port in `APP_BASE_URL`. If port 3000 is occupied, use another port in **both**
applications' `APP_BASE_URL` and pass that port to the frontend start command.

## EHR-backed demo

From the root:

```sh
npm run fhir:reset -- demo-mock
npm run fhir:users
npm run notify:contacts
```

Reset reloads synthetic EHR data and writes the same appointment plan to the
ClinicSoft demo practice. It does not erase Brevicor visits, photos, or audit events.
Use only the existing demo datasets and configured contacts you control.

With the gateway running, from `apps/web`:

```sh
npm run visits:sync -- demo-mock
npm run visits:sync -- demo-clinicsoft
```

Sign in at `/doctor/login` as `physician.one@demo.brevicor.test` or
`physician.two@demo.brevicor.test`, using the root's `DEMO_USER_PASSWORD`.
Select **demo-mock** or **demo-clinicsoft** in the clinic switcher. Only physician
memberships appear; the second account's staff-only HAPI membership is excluded.

Dashboard entry syncs today plus 14 days in Ontario time. **Re-sync appointments**
refreshes EHR changes without rebuilding demo data. Three-second dashboard polling
reads persisted visits and does not repeatedly sync. Previous-day active visits and
early-arrival indicators remain visible.

Use **New patient link** to rotate an invitation and copy its replacement. The old
link immediately loses access, and the replacement requires DOB verification again.
Open it in a patient tab, use that synthetic Patient's FHIR `birthDate`, and check in
within the existing 15-minute early / 30-minute late window. Admit the patient from
the dashboard. A joined call survives invitation rotation. Rescheduling resets a
waiting patient; cancelling an active call blocks new joins while the physician
can finish the existing call. Ending a call never completes the FHIR Encounter.

The doctor dashboard sends a presence heartbeat immediately and every 30 seconds.
Online physicians receive the in-app alert instead of waiting-room SMS. Notification
failures do not undo sync or check-in. Twilio trial accounts need the root's
`TWILIO_TRIAL_TEMPLATES=true`; recipients then see Twilio sample text, without the
real invitation link. A `sent` result means provider acceptance, not delivery.

## Persistent activity and photos

`visits` contains FHIR references and scheduling/session state, never patient names,
DOB, contacts, health cards, or clinical resources. Names, DOB, reasons, and chart
data are fetched from the gateway per request. Unsupported secondary chart sections
remain empty; an unavailable Patient produces an unavailable-chart message.

`visit_events` records atomic state changes and sanitized notification outcomes.
It never stores submitted DOBs, invitation links, tokens, message bodies, or notes.
Only SHA-256 invitation hashes are persisted. Notification delivery is best effort:
there is no durable outbox or automatic retry of failed keys. An operator retry
requires a fresh key and a fresh link when the original token is no longer available.

`visit_photos` stores Cloudinary references, source, dimensions, notes, and diagnosis.
Cloudinary continues storing the images. Configure the two `NEXT_PUBLIC_CLOUDINARY_*`
variables with the existing cloud and unsigned upload preset. JPEG, PNG, WebP, and
AVIF uploads support up to 20 MB, with 30 photos per visit enforced in the database.
Patient camera submissions, physician video captures, filters, region selection,
annotations and low-data image delivery retain their existing behavior.

Photo history is matched by `(clinic_id, patient_ref)`. A physician with an assigned
visit can see that patient's history across physicians in the same clinic; patient
access remains restricted to the verified visit. Photos and notes survive restarts.
`document_ref` is reserved for future FHIR chart attachment work.

All memory tables and RPCs are server-only with RLS enabled and no anonymous or
authenticated grants. Polling works across independent server processes; no Supabase
Realtime browser access is required.

## Booking, video and remaining limits

`/book`, its APIs and navigation are disabled by default. An isolated development
booking preview is available with `BOOKING_ENABLED=true` and `VISIT_STORE=memory`.
It uses the static directory, supports slot selection and DOB preview verification,
and never writes demographics to Supabase or sends notifications. Its bookings are
not appointments in the EHR or the persistent physician dashboard.

`COMMS_PROVIDER=local` provides same-browser WebRTC. `twilio` additionally needs the
three Twilio video credentials in `.env.example`. Providers remain behind the existing
comms interfaces. Telephone appointments sync and receive appropriate notification
templates; PSTN calls and transcription remain future work.

## Commands and verification

```sh
npm test
npm run typecheck
npm run build
npm run start -- -p 3000
```

Tests include the existing Cloudinary regressions, memory/sync/auth tests, and isolated
Supabase persistence tests when database environment settings are present. They do not
send SMS. At the root, `npm test` runs gateway/notification tests. To assert the installed
schema is free of demographics and public grants:

```sh
npx supabase db query --remote --read-only --file tests/sql/memory-schema.sql
```

The future cron entrypoint is `GET /api/cron/sync-visits?clinicId=<id>`, authenticated
with `Authorization: Bearer <CRON_SECRET>`. No recurring job is installed.

For explicit **live** verification, run two production frontends against the same DB
and `SESSION_SECRET`, then run the script from `apps/web`. It uses `APP_BASE_URL` and
`SECOND_WEB_URL` (default `http://localhost:3002`), attempts real notification sends,
and uploads a synthetic image to the configured Cloudinary account:

```sh
node --conditions=react-server --import tsx scripts/verify-memory-flow.ts --send-notifications
# Restart both frontend processes, then:
node --conditions=react-server --import tsx scripts/verify-memory-flow.ts --restart-check
```

The ignored snapshot contains only IDs and a demo physician login, without patient
demographics, links, DOBs, or cookies. Do not rebuild between the two phases, since
Next clears `.next`. See `docs/memory-verification.md` at the repo root for recorded
results from both clinics.

## Layout

| Path | Responsibility |
| --- | --- |
| `src/lib/clinical/` | Authenticated gateway reads, direct FHIR patient references, chart mapping. |
| `src/lib/visits/` | Reference-only types, atomic stores, synchronization, tokens and activity services. |
| `src/lib/auth/`, `src/lib/supabase/` | Physician sessions, clinic membership, patient/call capabilities, server-only DB access. |
| `src/media/` | Persistent photo references, notes and patient history; Cloudinary upload. |
| `src/lib/notify.ts` | Existing root notification API client. |
| `src/app/api/doctor/`, `src/app/api/visit/` | Ownership-checked physician and verified-patient routes. |

Shared migrations remain at root `supabase/migrations`; apply them from the root with
`npm run db:push`. No EHR-specific logic or direct clinical database access belongs here.
