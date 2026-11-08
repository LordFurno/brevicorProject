# Brevicor Telemedicine: FHIR R4 EHR Integration Layer

The telemedicine app reads and writes clinical data **only** through one FHIR R4
API, `/api/fhir/R4`. Behind it, each clinic is wired to its EHR through a
*provider*:

| Mode | Provider | What it talks to |
|---|---|---|
| `mock` | `lib/fhir/providers/mock.ts` | Synthetic data (Synthea) in Supabase, table `fhir_resources` |
| `fhir` | `lib/fhir/providers/native.ts` | Any FHIR R4 server, e.g. an EHR's FHIR endpoint |
| `adapter` | *phase 2* | Proprietary EHR APIs, translated to FHIR |

Every provider implements `EhrProvider` (`lib/fhir/provider.ts`) and passes the
same conformance suite, so the app never needs to know which one it's using.
The app-facing contract is in [docs/fhir-contract.md](docs/fhir-contract.md). The product
spec is in [docs/specs.md](docs/specs.md) (§2.1 and §4H).

## Requirements

- Node.js 24+
- Access to the Brevicor Supabase project (region `ca-central-1`)
- To generate synthetic data: Java 17+, **or** Docker
- Optional: Docker, to run the conformance suite against a local HAPI FHIR server

## Setup

```bash
npm install
```

Create `.env.local` (git-ignored):

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | yes | `https://<project-ref>.supabase.co` |
| `SUPABASE_SECRET_KEY` | yes | Supabase **secret** key (`sb_secret_…`). Server-side only. Bypasses RLS. Never give it a `NEXT_PUBLIC_` prefix or import it into client code. |
| `INTERNAL_SERVICE_TOKEN` | for server-side callers | Shared secret that server-side code (no logged-in user) sends as a bearer token. At least 32 characters, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Service auth is off when it's unset or shorter. |
| `DEMO_USER_PASSWORD` | for demo logins | Password that `fhir:users` sets on the demo physicians and `fhir:token` signs in with. |
| `FHIR_TIMEZONE` | no | Timezone used for dates in searches and stored data when they don't carry one. Default `America/Toronto`. If you change it, run a reset afterwards. |
| `FHIR_LOG` | no | Set to `silent` to turn off gateway logs (tests do this automatically). |
| `HAPI_FHIR_URL` | no | Tests only. Runs the conformance suite against this FHIR server. |

A clinic whose EHR needs a bearer token stores only the env var's *name* in
`ehr_connections.auth` (`{"type":"bearer","tokenEnv":"CLINIC_X_TOKEN"}`). The
token itself goes in the environment, never in the database.

### Database

Migrations live in `supabase/migrations/`. Apply them to the linked project:

```bash
npx supabase link            # once, if this checkout isn't linked yet
npm run db:push              # = supabase db push --remote
```

Supabase CLI v3 targets the *local* stack by default, so the script passes
`--remote`.

The migration creates `ehr_connections` and `fhir_resources`. Both have RLS
enabled with no policies, and the public API roles get no grants, so only the
secret key can access them. It also seeds two clinics:

| clinic_id | mode | notes |
|---|---|---|
| `demo-mock` | mock | Synthea data, loaded by the scripts below |
| `hapi-public` | fhir | `https://hapi.fhir.org/baseR4`, **read-only** (`read_only = true`). It's a public test server, so the gateway never writes to it. |

## Synthetic data (Synthea)

Generate about 50 patients into `./synthea-output/` (git-ignored). The run
writes `fhir/` (used by the import) and `csv/` (not used).

```bash
mkdir -p .synthea
curl -L -o .synthea/synthea-with-dependencies.jar \
  https://github.com/synthetichealth/synthea/releases/download/master-branch-latest/synthea-with-dependencies.jar

# With Java 17+:
java -jar .synthea/synthea-with-dependencies.jar -p 50 -s 42 \
  --exporter.baseDirectory ./synthea-output --exporter.fhir.export true --exporter.csv.export true

# Or with Docker (no Java needed):
docker run --rm -v "$PWD:/work" -w /work eclipse-temurin:21-jre \
  java -jar .synthea/synthea-with-dependencies.jar -p 50 -s 42 \
  --exporter.baseDirectory ./synthea-output --exporter.fhir.export true --exporter.csv.export true
```

`-s 42` fixes the random seed, so everyone gets the same dataset. Synthea's
people are US-based (Massachusetts by default) and their names carry numeric
suffixes (e.g. `Abbott774`). That's expected.

## Loading, seeding and resetting mock data

The scripts only ever write to clinics whose mode is `mock`.

```bash
# Import Patient, Practitioner, Organization and the 10 most recent Encounters per patient
npm run fhir:import -- demo-mock ./synthea-output/fhir [--max-encounters 10]

# Replace the clinic's Appointments with ~20 around now (today + tomorrow, clinic time)
npm run fhir:seed -- demo-mock

# Wipe the clinic, re-import and re-seed (default dir ./synthea-output/fhir)
npm run fhir:reset -- demo-mock [dir]
```

- **Import** is idempotent: rows are upserted on stable Synthea UUIDs, in
  batches. Synthea's `urn:uuid:` and conditional references
  (`Practitioner?identifier=…|…`) are rewritten to `Type/id`. References to
  things we don't import (Location, Condition, …) become logical references
  (`identifier` / `display`), so nothing dangles.
- **Seed** creates bookings in clinic hours today and tomorrow. Two of them
  start in 10 and 30 minutes, for waiting-room demos. Most are `booked` and a
  few are `cancelled`. Each has a Patient and a Practitioner actor and is
  marked video or telephone (see the contract doc). Re-running it on the same
  day gives the same schedule.

## Authentication

Every request, `/metadata` included, needs `Authorization: Bearer <token>`.
There are two kinds of caller. Patients never have accounts and never call
this API.

| Caller | Token | Clinic |
|---|---|---|
| Physician / staff | Supabase Auth access token (email + password sign-in) | From their `clinic_members` rows. If they belong to several clinics, `X-Clinic-Id` picks one and must be one of theirs. |
| Server-side code with no logged-in user (e.g. the patient DOB check) | `INTERNAL_SERVICE_TOKEN` | `X-Clinic-Id` (required) |

| Problem | Response |
|---|---|
| No token, invalid or expired token, or `X-Clinic-Id` on its own | 401 |
| Multi-clinic user or service token with no `X-Clinic-Id` | 400 |
| `X-Clinic-Id` isn't one of the user's clinics, or the user has no clinic | 403 |
| Unknown clinic (service token) | 404 |

How it works:
- Tokens are verified by `resolveCaller()` in `lib/fhir/auth.ts`. This
  project signs tokens with ES256, so `getClaims()` checks the signature
  locally against Supabase's public keys.
- A token keeps working until it expires (1 hour), even after the user signs out.
- Memberships are read on every request, so removing someone takes effect immediately.
- Each log line records `caller` (`user`/`service`) and the user id.

`clinic_members(user_id, clinic_id, practitioner_ref, role)` links a login to
its clinics and its FHIR Practitioner. It has RLS: a signed-in user can read
only their own rows, which is how a physician UI finds "my clinics" and "my
Practitioner". Only the server writes memberships.

### Demo users

Run this after seeding appointments:

```bash
npm run fhir:users     # needs DEMO_USER_PASSWORD; safe to re-run
```

| Email | Clinics |
|---|---|
| `physician.one@demo.brevicor.test` | `demo-mock` (physician, linked to the Practitioner with the most seeded appointments) |
| `physician.two@demo.brevicor.test` | `demo-mock` (physician, the second Practitioner) and `hapi-public` (staff). Needs `X-Clinic-Id`. |

`npm run -s fhir:token -- <email>` signs in and prints only the access token.

Recommended: in the Supabase dashboard, turn off public sign-ups (Auth →
Providers → Email → "Allow new users to sign up"). Self-registered accounts
get 403 anyway, since they have no clinic, but there's no reason to allow them.

## Running

```bash
npm run dev
```

```bash
B=http://localhost:3000/api/fhir/R4
# Clinic-local dates. Plain `date` gives the machine's zone (Git Bash can't do IANA zones), so use Node:
read TODAY TOMORROW < <(node -e 'const f=d=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Toronto"}).format(d);console.log(f(new Date()),f(new Date(Date.now()+864e5)))')

# Physician in one clinic
T1=$(npm run -s fhir:token -- physician.one@demo.brevicor.test)
curl -H "Authorization: Bearer $T1" "$B/metadata"
curl -H "Authorization: Bearer $T1" "$B/Appointment?date=ge$TODAY&date=lt$TOMORROW"
curl -H "Authorization: Bearer $T1" "$B/Appointment?practitioner=<their Practitioner id>&date=ge$TODAY&status=booked"
curl -H "Authorization: Bearer $T1" "$B/Patient/<id from an appointment's participant.actor>"

# Physician in two clinics: pick one
T2=$(npm run -s fhir:token -- physician.two@demo.brevicor.test)
curl -H "Authorization: Bearer $T2" -H "X-Clinic-Id: demo-mock"   "$B/Patient?_count=5"
curl -H "Authorization: Bearer $T2" -H "X-Clinic-Id: hapi-public" "$B/Patient?family=Smith&_count=5"   # same Bundle shape

# Server-side code (no user)
SVC=$(grep ^INTERNAL_SERVICE_TOKEN= .env.local | cut -d= -f2-)
curl -H "Authorization: Bearer $SVC" -H "X-Clinic-Id: demo-mock" "$B/Appointment/<id>"
```

Every error is an `OperationOutcome` with `Content-Type: application/fhir+json`.

## Tests

```bash
npm test                    # everything: unit + integration + conformance
npm run test:unit           # no network needed
npm run test:conformance    # provider contract vs the mock (needs Supabase env)
npm run typecheck
```

`tests/integration/auth.test.ts` tests authentication end to end against real
Supabase Auth. It creates throwaway clinics and users, signs them in, and
deletes everything afterwards.

`tests/conformance/provider-contract.ts` is **one** suite that every provider
must pass. It loads a canonical fixture set into the backend and checks reads,
every required search param, paging, errors, and writes where supported, all
through the real gateway. The mock run uses a throwaway clinic (`cf-xxxxxxxx`)
that it deletes afterwards.

To run it against a native FHIR server (HAPI in Docker):

```bash
docker run -d --name brevicor-hapi -p 8080:8080 hapiproject/hapi:latest   # ~1 min to start
HAPI_FHIR_URL=http://localhost:8080/fhir npm run test:conformance
```

Never point `HAPI_FHIR_URL` at a shared server: the suite writes fixtures.

## Layout

```
app/api/fhir/R4/[...path]/route.ts   Next.js route → handleFhirRequest
lib/fhir/gateway.ts                   caller → clinic's ehr_connections row → provider → dispatch (server-only)
lib/fhir/auth.ts                      resolveCaller(): Supabase access token or service token → clinic
lib/fhir/dispatch.ts                  FHIR REST handling: routing, capability checks, validation, envelopes
lib/fhir/provider.ts                  EhrProvider interface + capability/connection types
lib/fhir/providers/                   mock.ts, mock-index.ts (search columns), native.ts, index.ts (mode switch)
lib/fhir/search.ts                    search parsing (dates/prefixes/timezones, references, tokens, strings)
lib/fhir/validate.ts                  structural R4 validation for the gateway's resource types
lib/fhir/{bundle,capability-statement,outcome,log,connections}.ts
lib/supabase/admin.ts                 secret-key client (server-only)
scripts/                              import-synthea.ts, seed-appointments.ts, reset.ts, seed-users.ts, token.ts (+ lib/)
supabase/migrations/                  schema, seeded clinics, clinic_members
tests/unit/, tests/integration/, tests/conformance/
```

### Adding a provider (phase 2 adapters)

1. Implement `EhrProvider` in `lib/fhir/providers/<name>.ts`. Declare honest
   `capabilities()`. Throw `FhirError` for failures.
2. Add its mode to `createProvider()` in `lib/fhir/providers/index.ts`. That's
   the only place that switches on mode.
3. Add a harness in `tests/conformance/` that loads `FIXTURES` into the EHR (or
   its fake) and calls `runProviderContract()`. The provider isn't done until
   that suite passes.

## Privacy and residency

- Logs never contain resource contents or search values. The gateway logs
  clinic, interaction, type, id, param **names**, status and duration.
  Next's own request logging is turned off for `/api/fhir/*` because search
  URLs carry patient data.
- Supabase (`ca-central-1`) and Vercel functions (`yul1`, Montréal; see
  `vercel.json`) keep data in Canada. `hapi-public` is a public US test server
  holding synthetic data only. Never connect it to real patient data.
