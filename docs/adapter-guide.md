# FHIR Resource Mapping and Adapter Development Guide

How to connect an EHR that **doesn't speak FHIR** to the Brevicor FHIR R4 API,
using a vendor definition file instead of code. The worked example is
`vendors/clinicsoft.yaml`, which serves "ClinicSoft" (a fake proprietary EMR in
this repo) through the same `/api/fhir/R4` contract as the mock and native-FHIR
clinics.

```
app ──FHIR──▶ /api/fhir/R4 ──▶ gateway (auth, capability checks, validation, Bundles)
                                   │
                                   ▼
                       AdapterProvider (lib/fhir/providers/adapter/)
                         1. FHIR search params → normalized object
                         2. request templates → vendor REST call
                         3. JSONata map → FHIR resource → validated
                                   │
                                   ▼
                      vendor REST API (ClinicSoft: /api/mock-vendors/clinicsoft/v2)
```

Everything vendor-specific lives in `vendors/<name>.yaml`. The engine has no
idea ClinicSoft exists. The app can't tell an adapter clinic from any other:
the contract suite (`tests/conformance/provider-contract.ts`) runs unchanged
against it.

---

## 1. Adding a vendor: the checklist

1. **Write `vendors/<name>.yaml`.** Copy `clinicsoft.yaml` and change the
   sections below.
2. **Golden fixtures.** Add `tests/golden/<name>/*.json`: a real (de-identified)
   vendor record plus the exact FHIR you expect from it. Copy
   `tests/unit/clinicsoft-golden.test.ts`. Cover every code in every `codes`
   table, and the timezone edge cases.
3. **Contract harness.** Load the canonical `FIXTURES` into a sandbox of the
   vendor (or its test double) and call `runProviderContract()`. See
   `tests/conformance/clinicsoft.test.ts`. **The vendor isn't supported until
   this passes.**
4. **Credentials.** Put the API key in an env var (never in YAML or the database).
5. **Wire a clinic.** Add an `ehr_connections` row with `mode = 'adapter'`
   (section 9).
6. **Document** anything the vendor can't represent, as section 10 does for ClinicSoft.

---

## 2. The file, top to bottom

### Header

```yaml
vendor: clinicsoft            # must match the file name
name: ClinicSoft              # used in 502 messages ("ClinicSoft returned a Patient record that…")
timezone: America/Toronto     # zone of the vendor's offset-less local dates/times
```

### Auth

```yaml
auth:
  type: apiKey
  header: X-API-Key
```

The definition says *how* to authenticate. The clinic's connection says *which*
credentials, by env-var name (`ehr_connections.auth = {"type":"apiKey","keyEnv":"CLINICSOFT_API_KEY"}`).

| `type` | Status | Connection `auth` |
|---|---|---|
| `apiKey` | implemented | `{ "type": "apiKey", "keyEnv": "…" }` |
| `oauth2_client_credentials` (`tokenUrl`, optional `scope`) | interface only; returns 501 | `{ "type": "oauth2_client_credentials", "clientIdEnv": "…", "clientSecretEnv": "…" }` |

To implement OAuth2, fill in `OAuth2ClientCredentials.headers()` in
`lib/fhir/providers/adapter/auth.ts`: POST `grant_type=client_credentials`,
cache the token until shortly before `expires_in`, and send it as a bearer token.

### Paging

```yaml
paging:
  pageParam: page        # 1-based (set firstPage: 0 for zero-based vendors)
  sizeParam: pageSize
  maxPageSize: 100
```

FHIR `_count`/`_offset` become `pageSize`/`page`. A vendor that pages by page
number can't start mid-page, so an `_offset` that isn't a multiple of
`_count` is a 400. The gateway's own `next` links always land on a page boundary.
`_count=0` asks for one row and returns only the total.

### Config

```yaml
config:
  chartNoSystem: https://clinicsoft.example/fhir/sid/chart-no
```

These are default values visible to expressions as `$config.<name>`. A clinic
overrides them in `adapter_config.config`. This is how each clinic gets its
own identifier systems: demo-clinicsoft uses Synthea's MRN system, and the
contract harness uses the fixtures' systems.

### Codes

```yaml
codes:
  appointmentStatus: { B: booked, C: cancelled, N: noshow, A: arrived }
  visitMode: { VIRT_VIDEO: video, VIRT_PHONE: telephone }
```

These are vendor code → FHIR code tables, used two ways:
- **In maps:** `$lookup('appointmentStatus', status)` → `booked`. A code that
  isn't in the table is a **mapping error (502)**, never a guess.
- **In searches:** a `token` param with `codes: appointmentStatus` turns
  `status=cancelled` into the vendor code `C`. A FHIR code with no vendor
  equivalent (`status=proposed`) matches nothing, and the vendor isn't called.

### Resources

Each FHIR type the vendor serves gets an entry with any of `read`, `search`,
and a required `map`. A type or interaction left out is **unsupported**: it's
missing from `/metadata` and returns 501. ClinicSoft serves Organization by
read only, for example.

```yaml
  Appointment:
    read: { path: "/schedule/{id}", result: appointment }
    search: …
    map: |
      …
```

- `read.path` is a template. `{id}` is the FHIR id from the URL, URL-encoded.
- `read.result` and `search.results` are JSONata paths into the vendor's
  response (ClinicSoft wraps records: `{ "appointment": {…} }`, `{ "appointments": [...] }`).
- `search.total` is the path to the vendor's total count, if it has one.

---

## 3. Search: from FHIR params to a vendor request

### Step 1: declare the params

```yaml
    search:
      params:
        _id: { type: id }                                  # served via the read endpoint
        patient: { type: reference, target: Patient }
        practitioner: { type: reference, target: Practitioner }
        actor:
          type: reference
          target: [Patient, Practitioner]
          as: { Patient: patient, Practitioner: practitioner }
        date: { type: date, prefixes: [eq, ge, gt, le, lt], precision: day }
        status: { type: token, codes: appointmentStatus, multiple: true }
```

Only declared params appear in `/metadata`. The gateway rejects anything else
with 400 before the adapter runs.

### Step 2: the engine normalizes them

| `type` | FHIR | Normalized (what templates see) |
|---|---|---|
| `id` | `_id=a1` | `_id: { value: 'a1' }` |
| `string` | `family=tre,ngu` | `family: { value: 'tre', values: ['tre', 'ngu'] }` |
| `token` | `status=cancelled` | `status: { value: 'C', values: ['C'], system }` |
| `reference` | `actor=Practitioner/d1` | `practitioner: { type: 'Practitioner', id: 'd1' }` (via `as`) |
| `date` | `date=ge2026-11-07&date=lt2026-11-08` | `date: { start: '2026-11-07T05:00:00Z', end: '2026-11-08T05:00:00Z' }` (end exclusive) |

Notes on how each type is normalized:
- **Dates:** FHIR prefixes become one interval, and repeated date params
  intersect. A date with no offset is read in the vendor's `timezone`.
- **References:** accepts `id`, `Type/id`, an absolute URL, or `:Type`. `as`
  routes several FHIR params into one slot, so `actor=Practitioner/d1` and
  `practitioner=d1` both fill `practitioner`.
- **Tokens with `system`:** e.g. `identifier: { type: token, system: "{$config.chartNoSystem}" }`.
  A search for a different system matches nothing, which is correct FHIR
  semantics. The vendor isn't called.

### Step 3: request templates

```yaml
      path: /schedule
      query:
        patientNo: "{patient.id}"
        providerNo: "{practitioner.id}"
        from: "{$localDate(date.start)}"
        to: "{$lastLocalDate(date.end)}"
        status: "{$join(status.values, ',')}"
```

- Anything in `{…}` is a JSONata expression evaluated against the normalized
  object, with the helpers below.
- A query param whose expression comes out empty is left off the request.
- A template that is exactly one `{expr}` passes the raw value; otherwise the
  parts are joined as a string.

### What becomes a 400 (never silently ignored)

| Situation | Example |
|---|---|
| Comma (OR) on a param without `multiple: true` | `given=ann,bob` |
| Date prefix not in `prefixes` | `date=ne2026-11-07` |
| More precision than `precision: day` allows | `date=ge2026-11-07T10:00` |
| Two conditions that land on one vendor param and disagree | `actor=Practitioner/d1&practitioner=d2` |
| The same non-date param twice (AND) | `family=a&family=b` |
| `_id` combined with anything else | `_id=1&family=x` |
| An untyped reference on a multi-target param | `actor=d1` (use `actor=Practitioner/d1`) |
| Modifiers other than a reference type | `family:exact=X` |
| `_offset` off the vendor's page grid | `_offset=7&_count=20` |

If a vendor can't express something the app needs, fix the vendor side or
describe a different mapping. Dropping the condition would return wrong results.

---

## 4. Mapping: vendor JSON → FHIR with JSONata

`map` is one JSONata expression (https://docs.jsonata.org) evaluated against a
single vendor record. It must return the FHIR resource.

```yaml
    map: |
      (
        $start := $localToUtc(apptDate, startTime);
        {
          "resourceType": "Appointment",
          "id": apptId,
          "status": $lookup('appointmentStatus', status),
          "serviceType": [{ "coding": [{ "system": "https://brevicor.ca/fhir/CodeSystem/consultation-modality",
                                          "code": $lookup('visitMode', type) }] }],
          "start": $start,
          "end": $addMinutes($start, duration),
          "participant": [
            patientNo ? { "actor": $reference('Patient', patientNo), "status": "accepted" },
            providerNo ? { "actor": $reference('Practitioner', providerNo), "status": "accepted" }
          ]
        }
      )
```

### Helpers

| Helper | Does | Example |
|---|---|---|
| `$localToUtc(date, time)` / `$localToUtc(dateTime)` | Vendor-local date/time → FHIR instant (UTC, no ms), in the vendor timezone | `$localToUtc('2026-11-18', '09:30')` → `2026-11-18T14:30:00Z` |
| `$addMinutes(instant, n)` | Adds real elapsed minutes | `$addMinutes($start, 15)` |
| `$lookup(table, code)` | Code-table lookup. Unknown code → 502 | `$lookup('sex', 'F')` → `female` |
| `$reference(type, id)` | `{ "reference": "Type/id" }`, or nothing if the id is empty | `$reference('Patient', patientNo)` |
| `$date(value, format)` | Vendor date → FHIR date (`DD`, `MM`, `YYYY`) | `$date('15/05/1980', 'DD/MM/YYYY')` → `1980-05-15` |
| `$localDate(instant, format?)` | Instant → vendor-local date (for request templates) | `$localDate(birthdate.start, 'DD/MM/YYYY')` |
| `$lastLocalDate(endExclusive, format?)` | Last local day before an exclusive end (for inclusive "to" params) | `$lastLocalDate(date.end)` |
| `$config` | The merged per-clinic config | `$config.chartNoSystem` |

All helpers return nothing for missing input, so optional vendor fields simply drop out.

### What the engine does after your expression

1. **Prunes** `null`, `""`, `[]` and `{}`, which FHIR forbids, so you can
   write `"given": [firstName, middleName]` without guarding nulls.
2. **Versions** the resource. If the vendor has no version ids,
   `meta.versionId` is a hash of the record, which changes when the record
   changes. That drives ETags.
3. Runs an `afterMap` **hook**, if the vendor has one (section 7).
4. **Validates** the result as FHIR R4.

**Mapping failures are 502s.** An exception or unknown code becomes
`ClinicSoft returned a Patient record that could not be mapped to FHIR: a code
is missing from table 'sex'`. Invalid FHIR becomes `ClinicSoft: the Patient
mapping produced invalid FHIR R4`, plus the issue paths. Messages name the
vendor, type, table or path, **never field values**, which may be PHI.

---

## 5. Dates and time zones

ClinicSoft stores local wall times with no offset (`apptDate: 2026-11-18`,
`startTime: 09:30`). `$localToUtc` converts them using the definition's
`timezone`, correctly across DST:

| Local time (America/Toronto) | UTC | Why |
|---|---|---|
| 2026-03-08 09:00 | 13:00Z | DST has started: EDT, UTC-4 |
| 2026-11-01 09:00 | 14:00Z | DST has ended: EST, UTC-5 |
| 2026-03-08 **02:30** | 07:30Z | Doesn't exist (clocks jump 02:00→03:00): moves forward to 03:30 EDT |
| 2026-11-01 **01:30** | 05:30Z | Happens twice: the first (EDT) occurrence wins |
| 01:45 + 30 min on 2026-03-08 | 06:45Z → 07:15Z | Durations are real minutes, so it ends at 03:15 EDT |

Every row is a golden test (`tests/golden/clinicsoft/appointment-dst-*.json`).
The same conversion handles search bounds, so `date=ge2026-11-07` means
midnight in the clinic's timezone.

---

## 6. Vendor errors

| Vendor response | FHIR API response |
|---|---|
| 401 / 403 | 502 `security` (our credentials are wrong, not the caller's) |
| 404 on a read | 404 `not-found` |
| 400 / 404 / 422 on a search | 502 `exception` (we built a request the vendor didn't accept: an adapter bug) |
| 429 | 503 `throttled` |
| 5xx, network failure | 502 `transient` |
| Timeout (15 s) | 504 `timeout` |

---

## 7. Code hooks (escape hatch)

When something truly can't be expressed in YAML (request signing, a field
that needs real code), register hooks in `lib/fhir/providers/adapter/hooks.ts`
and reference them with `hooks: <name>`:

```ts
VENDOR_HOOKS['acme'] = {
  beforeRequest({ url, headers }, { type }) { headers.set('X-Signature', sign(url)); },
  afterMap(resource, record, { type }) { return resource; },
};
```

Prefer the mapping file. Every hook is code to review and test. ClinicSoft uses none.

---

## 8. Search semantics worth knowing

- **Strings:** FHIR string search is a case- and accent-insensitive "starts
  with". ClinicSoft's `lastName`/`firstName` search behaves the same, so the
  mapping is exact.
- **Encounter `date`:** FHIR means the whole period overlaps the range.
  ClinicSoft can only filter by the day an encounter **starts**. The YAML says
  so, and you should flag this to the app team if it matters. For outpatient
  and virtual visits, which start and end the same day, it is equivalent.

---

## 9. Wiring a clinic

```sql
insert into public.ehr_connections (clinic_id, name, mode, auth, adapter_config) values (
  'demo-clinicsoft', 'Demo Clinic (ClinicSoft EMR)', 'adapter',
  '{"type": "apiKey", "keyEnv": "CLINICSOFT_API_KEY"}',
  '{"vendor": "clinicsoft",
    "baseUrlEnv": "CLINICSOFT_BASE_URL",
    "config": {"chartNoSystem": "http://hospital.smarthealthit.org", ...}}'
);
```

| `adapter_config` key | Meaning |
|---|---|
| `vendor` | Which `vendors/<vendor>.yaml` to use |
| `baseUrl` / `baseUrlEnv` | The clinic's vendor base URL, directly or via an env var. Falls back to the definition's `baseUrl` |
| `config` | Overrides for the definition's `config` |

Then add the clinic's staff to `clinic_members`. `npm run fhir:users` does this
for the demo physicians. Definitions are read from disk at runtime;
`next.config.ts` includes `vendors/**` in the deployment bundle.

---

## 10. ClinicSoft reference

### The fake vendor

`lib/vendors/clinicsoft/api.ts`, served at
`/api/mock-vendors/clinicsoft/v2/practices/{practice}/…`. Data lives in the
Supabase schema `clinicsoft`, one row set per practice. It deliberately looks
nothing like FHIR:
- **Responses:** wrapped (`{ "appointments": […], "page", "pageSize", "totalCount" }`).
- **Paging:** `page`/`pageSize`.
- **Dates and codes:** DD/MM/YYYY dates of birth, local dates and times, and
  letter codes.
- **Auth and errors:** an `X-API-Key` header, and errors like `{ "error": { "code", "message" } }`.

| Endpoint | Filters |
|---|---|
| `patients`, `patients/{patientNo}` | `lastName`, `firstName` (prefix, comma = any), `dob`, `dobFrom`, `dobTo` (DD/MM/YYYY), `chartNo` |
| `providers`, `providers/{providerNo}` | `lastName`, `cpsoNo` |
| `organizations/{orgId}` | (none) |
| `schedule`, `schedule/{apptId}` | `providerNo`, `patientNo`, `from`, `to` (local dates), `status` (comma list) |
| `encounters`, `encounters/{encounterNo}` | `patientNo`, `providerNo`, `apptId`, `from`, `to` (by start date) |
| `documents`, `documents/{docId}` | `patientNo`, `encounterNo` |
| `problems`, `problems/{problemId}` | `patientNo`, `status` (comma list) |
| `allergies`, `allergies/{allergyId}` | `patientNo`, `status` |
| `prescriptions`, `prescriptions/{rxId}` | `patientNo`, `status` (comma list) |
| `results`, `results/{resultId}` | `patientNo`, `category`, `testCode` (comma lists), `from`, `to` (by local day) |

### Field mapping

| ClinicSoft | FHIR |
|---|---|
| `patients.patientNo` / `chartNo` | `Patient.id` / `identifier` (type MR, system `$config.chartNoSystem`) |
| `healthCardNo`, `healthCardVersion` | `identifier` (type JHN, system `$config.hcnSystem` = Ontario HCN; version in the CA Baseline `ext-identifierversion` extension) |
| `title`, `firstName`, `middleName`, `lastName`, `suffix` | `name[use=official]` prefix/given/family/suffix |
| `dob`, `deceasedDate` (DD/MM/YYYY) | `birthDate`, `deceasedDateTime` (date) |
| `sex` M/F/U | `gender` male/female/unknown |
| `cellPhone`, `homePhone`, `email` | `telecom` phone (use mobile/home), email |
| `address1`, `city`, `province`, `postalCode` | `address[0]` line/city/state/postalCode |
| `providers.title/firstName/lastName`, `cpsoNo`, `sex` | `Practitioner.name`, `identifier` (`$config.providerLicenceSystem`), `gender` |
| `schedule.apptDate` + `startTime`, `duration` | `Appointment.start`, `end`, `minutesDuration` |
| `schedule.status` B/C/N/A | `status` booked/cancelled/noshow/arrived |
| `schedule.type` VIRT_VIDEO/VIRT_PHONE | `serviceType` coding `consultation-modality` video/telephone (**the visit mode the app keys on**) |
| `schedule.reason` | `reasonCode[0].text` |
| `patientNo`, `providerNo` | `participant[].actor` (status `accepted`) |
| `encounters.encStatus` OPEN/CLOSED/VOID | `Encounter.status` in-progress/finished/cancelled |
| `encClass` | `class` (v3 ActCode: AMB, EMER, IMP, HH, VR) |
| `startDateTime`/`endDateTime` (local) | `period` |
| `apptId`, `orgId`, `encTypeCode/Desc` | `appointment`, `serviceProvider`, `type` (SNOMED) |
| `documents.*` | `DocumentReference` (status `current`, `content.attachment`, `context.encounter`) |
| `problems.status` A/R, `snomedCode`, `description` | `Condition.clinicalStatus` active/resolved, `code` (SNOMED CT) |
| `onsetDate`, `resolvedDate` (local dates) | `onsetDateTime` (also `recordedDate`), `abatementDateTime` (date only) |
| `allergies.status` A/I, `allergyType`, `category` FOOD/DRUG/ENV/BIO | `AllergyIntolerance.clinicalStatus` active/inactive, `type`, `category` food/medication/environment/biologic |
| `allergenCode`/`allergen`, `reaction1..2` + `severity1..2` MILD/MOD/SEV | `code` (SNOMED CT), `reaction[].manifestation`, `severity` mild/moderate/severe |
| `prescriptions.status` A/C, `rxnormCode`/`drugName`, `startDateTime`, `sig`, `reasonCode` | `MedicationRequest.status` active/completed, `medicationCodeableConcept` (RxNorm), `authoredOn`, `dosageInstruction.text`, `reasonCode` |
| `results.category` VS/LAB, `testCode`/`testName`, `resultDateTime` | `Observation.category` vital-signs/laboratory, `code` (LOINC), `effectiveDateTime` |
| `results.valueType` N / T / BP, `value`, `units` | `valueQuantity` (UCUM) / `valueCodeableConcept.text` / `85354-9` panel with diastolic + systolic `component`s, split from `"120/80"` |

Defaults the mapping supplies, because ClinicSoft doesn't store them:
`participant.status = accepted`, `DocumentReference.status = current`,
`Observation.status = final` (ClinicSoft holds only signed-off results),
`MedicationRequest.intent = order` (a ClinicSoft prescription is an order), and
`meta.versionId` as a content hash.

The clinical maps needed **no engine change**: the code tables, the token
`system` check, `multiple`, and JSONata's `$split`/`$number` cover them.

### Loading Synthea into ClinicSoft

`npm run clinicsoft:load` reads `./synthea-output/csv`.
- **Ids:** Synthea's CSV ids are **identical** to its FHIR ids, which we
  verified for all patients, providers, organizations and encounters. So
  `patientNo`, `providerNo` and the rest are the same ids demo-mock uses. No
  mapping table is needed.
- **Encounters:** like the FHIR import, it keeps the 10 most recent per patient.
- **Names and states:** the CSV has no practitioner name prefix, so the loader
  sets `title = 'Dr.'`, as Synthea's FHIR export does. US state names become
  two-letter codes.
- **Phones and emails:** never loaded. The seed assigns `DEMO_PHONE_NUMBERS` / `DEMO_EMAILS`.
- **Clinical history:** `conditions`, `allergies`, `medications` and
  `observations` CSVs, with the same caps as the FHIR import (all problems and
  allergies; prescriptions started in the last 2 years; vital-sign/lab results,
  the latest 3 per LOINC code per patient). `fhir:reset` passes one "now" to
  both so the medication window is identical.
- **Ids for clinical rows:** the CSV has none, so each row's id is a SHA-256
  of what identifies it (patient, encounter, code, start), shaped like a UUID,
  plus an ordinal for exact duplicates. The same CSV always yields the same ids.
- **Blood pressure:** the CSV has separate systolic (`8480-6`) and diastolic
  (`8462-4`) rows; the loader stores each reading the ClinicSoft way, one
  `85354-9` row with `value "120/80"`. The YAML rebuilds Synthea's FHIR panel.
- **Encounter links** to encounters that weren't loaded are left empty.
- **Health card numbers:** the same synthetic Ontario HCN as demo-mock
  (`scripts/lib/hcn.ts`), deliberately failing the check digit.

`npm run fhir:seed -- demo-mock` writes **one** appointment plan both as FHIR
(demo-mock) and as `clinicsoft.schedule` rows, so the two clinics are directly comparable.

### Fields that legitimately differ from demo-mock

`tests/integration/clinicsoft-equivalence.test.ts` asserts that every field
the adapter maps equals demo-mock's FHIR. These are the only exceptions:

| Resource | demo-mock has | Why the adapter doesn't |
|---|---|---|
| Appointment | `created`, `appointmentType` (ROUTINE/FOLLOWUP), `cancelationReason`, `participant.required` | ClinicSoft's schedule has no columns for them |
| Patient | Synthea extensions (race, ethnicity, birth sex, birthplace…), maiden name, SSN/driver's licence/passport identifiers, `maritalStatus`, `multipleBirth`, `communication`, address `country` and geolocation, narrative `text` | Not in Synthea's CSV / ClinicSoft's patient table |
| all | `meta.versionId`, `meta.lastUpdated` | Different versioning: database version vs content hash |
| Condition | `verificationStatus`, `category`, onset/abatement time of day | No columns; ClinicSoft keeps dates only (compared by day) |
| AllergyIntolerance | `verificationStatus`, `criticality`, reactions beyond the first two | Synthea's CSV export carries at most two reactions and no criticality |
| MedicationRequest | `category`, `requester`, `reasonReference`, `dosageInstruction` | Not in Synthea's medications CSV (ClinicSoft has `reasonCode` instead) |
| Observation | `issued`, value precision, coded text values | Synthea's CSV rounds numbers to one decimal and keeps only the text of coded results |

The fields the app depends on are asserted **identical** for every seeded
appointment and patient:
- **Appointment:** start, end, status, participants, visit mode.
- **Patient:** name, birth date, telecom (phone and email), MRN, health card number.
- **Clinical history of every booked patient:** each Condition, allergy,
  MedicationRequest and Observation matches by code, dates and status
  (Observations also by category and value, numbers within 0.05).

---

## 11. Out of scope (for now)

- **Writes through adapters.** Create and update return 501, and the
  definition format has no write section yet.
- **The document fallback store,** for EHRs that can't keep transcripts.
- **OAuth2 client credentials,** which is interface only.
