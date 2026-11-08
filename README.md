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

## Running

```bash
npm run dev
```

The clinic currently comes from an `X-Clinic-Id` header. This is a temporary
stand-in for authentication; see `clinicIdFromRequest()` in `lib/fhir/gateway.ts`.

```bash
B=http://localhost:3000/api/fhir/R4
# Clinic-local dates. Plain `date` gives the machine's zone (Git Bash can't do IANA zones), so use Node:
read TODAY TOMORROW < <(node -e 'const f=d=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Toronto"}).format(d);console.log(f(new Date()),f(new Date(Date.now()+864e5)))')

curl -H "X-Clinic-Id: demo-mock" "$B/metadata"
curl -H "X-Clinic-Id: demo-mock" "$B/Appointment?date=ge$TODAY&date=lt$TOMORROW"
curl -H "X-Clinic-Id: demo-mock" "$B/Patient/<id from an appointment's participant.actor>"
curl -H "X-Clinic-Id: demo-mock" "$B/Appointment?practitioner=<id>&date=ge$TODAY&status=booked"
curl -H "X-Clinic-Id: hapi-public" "$B/Patient?family=Smith&_count=5"     # same Bundle shape
```

Every error is an `OperationOutcome` with `Content-Type: application/fhir+json`.

## Tests

```bash
npm test                    # everything: unit + conformance
npm run test:unit           # no network needed
npm run test:conformance    # provider contract vs the mock (needs Supabase env)
npm run typecheck
```

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
lib/fhir/gateway.ts                   clinic → ehr_connections row → provider → dispatch (server-only)
lib/fhir/dispatch.ts                  FHIR REST handling: routing, capability checks, validation, envelopes
lib/fhir/provider.ts                  EhrProvider interface + capability/connection types
lib/fhir/providers/                   mock.ts, mock-index.ts (search columns), native.ts, index.ts (mode switch)
lib/fhir/search.ts                    search parsing (dates/prefixes/timezones, references, tokens, strings)
lib/fhir/validate.ts                  structural R4 validation for the gateway's resource types
lib/fhir/{bundle,capability-statement,outcome,log,connections}.ts
lib/supabase/admin.ts                 secret-key client (server-only)
scripts/                              import-synthea.ts, seed-appointments.ts, reset.ts (+ lib/)
supabase/migrations/                  schema + seeded clinics
tests/unit/, tests/conformance/
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
