# FHIR API contract (for the telemedicine app)

What the app can rely on from `/api/fhir/R4`, whatever EHR a clinic uses.
Everything here is enforced by `tests/conformance/provider-contract.ts`.

## Requests

- Base URL: `/api/fhir/R4`. FHIR R4 (4.0.1), JSON only (`application/fhir+json`).
- Every request, `/metadata` included, needs `Authorization: Bearer <token>`:
  - **Signed-in physician/staff:** their Supabase access token. The clinic is
    their membership. If they belong to several clinics, send `X-Clinic-Id`
    with one of theirs.
  - **Server-side code with no user** (e.g. the patient DOB check): the
    internal service token, plus `X-Clinic-Id` (required).
  - Patients never call this API.
- To find a physician's own FHIR Practitioner (for "my appointments"), read
  their `clinic_members.practitioner_ref` with their Supabase session, then
  search `Appointment?practitioner=<ref>`.
- Discover what a clinic supports with `GET /metadata` (CapabilityStatement).
  Writes in particular vary by clinic.

## Resources and interactions

| Resource | Always | Depends on the clinic's EHR (check `/metadata`) |
|---|---|---|
| Patient | read, search | |
| Practitioner | read, search | |
| Organization | read, search | |
| Appointment | read, search | |
| Encounter | read, search | create, update |
| DocumentReference | read, search | create |
| Condition | read, search | |
| AllergyIntolerance | read, search | |
| MedicationRequest | read, search | |
| Observation | read, search | |

The mock clinic (`demo-mock`) supports exactly the writes in the right-hand
column. `hapi-public` and `demo-clinicsoft` (a non-FHIR EMR behind the adapter)
are read-only. At `demo-clinicsoft`, Organization supports read but not search.

URLs: `GET /{type}/{id}`, `GET /{type}?…`, `POST /{type}`, `PUT /{type}/{id}`.
Anything else (DELETE, PATCH, `_history`, `$operations`, batch) returns 501.

## Search

Guaranteed parameters:

| Resource | Parameters |
|---|---|
| Patient | `_id`, `family`, `given`, `birthdate`, `identifier` |
| Practitioner | `_id`, `family`, `identifier` |
| Organization | `_id`, `identifier` (mock) |
| Appointment | `patient`, `practitioner`, `actor`, `date`, `status` |
| Encounter | `patient`, `subject`, `appointment`, `date` |
| DocumentReference | `patient`, `subject`, `encounter` |
| Condition | `patient`, `subject`, `clinical-status` |
| AllergyIntolerance | `patient` (R4 defines no `subject` here) |
| MedicationRequest | `patient`, `subject`, `status` |
| Observation | `patient`, `subject`, `category`, `code`, `date` |

Semantics (R4):

- **string** (`family`, `given`): case- and accent-insensitive "starts with".
- **token** (`identifier`, `status`, `_id`): `value`, `system|value`, or
  `|value` (no system).
- **reference**: `123`, `Patient/123`, an absolute URL, or `subject:Patient=123`.
- **date**: prefixes `eq` (default), `ge`, `gt`, `le`, `lt`. The value's
  precision defines a range: `2026-11-07` is that whole day. **Dates and times
  without an offset are in the clinic's timezone** (America/Toronto).
  Appointment `date` = `start`; Encounter `date` = `period`; Observation `date` = `effective[x]`.
- **CodeableConcept tokens** (`clinical-status`, `category`, `code`): `code`
  matches that code in any system; `system|code` matches only that system
  (`code=http://loinc.org|8867-4`, `clinical-status=active`).
- Comma means OR (`status=booked,arrived`). Repeating a parameter means AND
  (`date=ge2026-11-07&date=lt2026-11-08`).
- `_count`: default 20, max 100. `_count=0` returns the total only. Follow
  `link[relation=next]` to page. It uses `_offset`.
- An unknown parameter or modifier returns **400**. Unsupported date prefixes
  (`ne`, `sa`, `eb`, `ap`) return 400.
- **A clinic whose EHR can't express a search returns 400, never a silently
  wider result.** For example, at `demo-clinicsoft`:
  - dates filter by whole days only (`date=ge2026-11-07T10:00` → 400)
  - `_offset` must be a multiple of `_count`
  - `given` takes one value
  - `actor` needs a type (`actor=Practitioner/123`)

  The gateway's own `next` links always work.
- At `demo-clinicsoft`, Encounter `date` filters by the day the encounter
  starts. This is the same for same-day visits. Observation `date` also takes
  whole days only.

Results come back as a `searchset` Bundle with gateway `fullUrl`s and
`search.mode = match`. `total` is present when the EHR provides it.

## Appointment modality (video vs telephone)

`Appointment.serviceType` carries a coding from Brevicor's CodeSystem:

```json
{ "system": "https://brevicor.ca/fhir/CodeSystem/consultation-modality", "code": "video" }      // or "telephone"
```

This is the field to key on: every clinic sets it, including the adapter clinic.
`appointmentType` (v2-0276 `ROUTINE`/`FOLLOWUP`), `cancelationReason`
(R4 spelling) and `created` are present only where the EHR records them
(demo-mock does; ClinicSoft doesn't). The visit reason, where known, is in
`reasonCode[0].text`.

## Clinical history

What the chart reads. Every clinic holds the same demo history (Synthea),
capped the same way:

- **Condition**: all of them. `clinicalStatus` is `active` or `resolved`
  (`http://terminology.hl7.org/CodeSystem/condition-clinical`). The chart asks
  for `clinical-status=active`.
- **AllergyIntolerance**: all of them.
- **MedicationRequest**: authored in the last 2 years, with the drug in
  `medicationCodeableConcept` (RxNorm), never a `medicationReference`.
  `status` is `active` or `completed`. The chart asks for `status=active`.
- **Observation**: `vital-signs` and `laboratory` only, the latest 3 per LOINC
  code per patient. Blood pressure is one `85354-9` panel with diastolic
  (`8462-4`) and systolic (`8480-6`) components. Text results are in
  `valueString` or `valueCodeableConcept.text`.

Encounters that weren't kept (the 10 most recent per patient are) appear as
logical references (`display` only). A clinic whose EHR doesn't serve one of
these types leaves it out of `/metadata`; the chart then shows that section as
unavailable instead of empty.

## Patient identifiers

- MRN: `type` v2-0203 `MR`, the clinic's system.
- Ontario health card number (HCN): `system`
  `https://fhir.infoway-inforoute.ca/NamingSystem/ca-on-patient-hcn` (Canada
  Health Infoway's NamingSystem `ca-on-patient-hcn`, used by Ontario's OLIS R4
  and MI profiles; Infoway lists `http://ehealthontario.ca/API/FHIR/NamingSystem/ca-on-patient-hcn`
  as the older alternate, which readers should also accept). `type` v2-0203
  `JHN`; the two-letter version code is in the extension
  `http://hl7.org/fhir/ca/baseline/StructureDefinition/ext-identifierversion`
  (`valueString`). **Demo numbers are synthetic and deliberately fail the HCN
  check digit** (Luhn mod 10 over the first 9 digits), so none can be a real card.

## Patient phone numbers and emails

In demo data, the only contacts are `DEMO_PHONE_NUMBERS`
(`telecom.system = phone`, `use = mobile`) and `DEMO_EMAILS`
(`telecom.system = email`), assigned to the first patients with appointments
today. Every clinic, including the adapter clinic, holds the same ones. Other
patients have none. Don't fall back to anything else.

## Writes and versioning

- `POST` assigns the id (any client-sent id is ignored). It returns **201**
  with `Location: …/{type}/{id}/_history/{version}`.
- Responses carry `ETag: W/"<versionId>"`. Send `If-Match: W/"<versionId>"`
  on `PUT` to avoid overwriting someone else's change. A stale version
  returns **412**.
- Bodies are validated (structure, required elements, code sets). Invalid
  ones return **400** with an issue per problem.

## Errors

Every error is an `OperationOutcome`.

| Status | When |
|---|---|
| 400 | Bad search param/value, invalid resource body, id mismatch, or no `X-Clinic-Id` when one is required (multi-clinic user, service token) |
| 401 | No token, or an invalid/expired token (`WWW-Authenticate: Bearer`). `X-Clinic-Id` on its own is not enough. |
| 403 | `X-Clinic-Id` isn't one of the user's clinics, or the account has no clinic |
| 404 | Unknown clinic, unknown resource type, or resource not found (including resources that belong to another clinic) |
| 406 / 415 | Non-JSON `_format` / wrong `Content-Type` |
| 409 | Concurrent modification (retry) |
| 412 | `If-Match` version is stale |
| 501 | The clinic's EHR doesn't support this interaction |
| 502 | The EHR failed or returned something that isn't valid R4 |
| 503 / 504 | The EHR is rate limiting or timed out |

If the EHR returns an invalid resource inside a search, that entry is left
out and reported in an `OperationOutcome` entry (`search.mode = outcome`).
It is never silently dropped.
