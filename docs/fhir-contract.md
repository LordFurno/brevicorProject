# FHIR API contract (for the telemedicine app)

What the app can rely on from `/api/fhir/R4`, whatever EHR a clinic uses.
Everything here is enforced by `tests/conformance/provider-contract.ts`.

## Requests

- Base URL: `/api/fhir/R4`. FHIR R4 (4.0.1), JSON only (`application/fhir+json`).
- Clinic: the `X-Clinic-Id` header. **Temporary.** This will be replaced by
  the clinic from the authenticated physician's token.
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

The mock clinic (`demo-mock`) supports exactly the writes in the right-hand
column. `hapi-public` is read-only.

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

Semantics (R4):

- **string** (`family`, `given`): case- and accent-insensitive "starts with".
- **token** (`identifier`, `status`, `_id`): `value`, `system|value`, or
  `|value` (no system).
- **reference**: `123`, `Patient/123`, an absolute URL, or `subject:Patient=123`.
- **date**: prefixes `eq` (default), `ge`, `gt`, `le`, `lt`. The value's
  precision defines a range: `2026-11-07` is that whole day. **Dates and times
  without an offset are in the clinic's timezone** (America/Toronto).
  Appointment `date` = `start`; Encounter `date` = `period`.
- Comma means OR (`status=booked,arrived`). Repeating a parameter means AND
  (`date=ge2026-11-07&date=lt2026-11-08`).
- `_count`: default 20, max 100. `_count=0` returns the total only. Follow
  `link[relation=next]` to page. It uses `_offset`.
- An unknown parameter or modifier returns **400**. Unsupported date prefixes
  (`ne`, `sa`, `eb`, `ap`) return 400.

Results come back as a `searchset` Bundle with gateway `fullUrl`s and
`search.mode = match`. `total` is present when the EHR provides it.

## Appointment modality (video vs telephone)

`Appointment.serviceType` carries a coding from Brevicor's CodeSystem:

```json
{ "system": "https://brevicor.ca/fhir/CodeSystem/consultation-modality", "code": "video" }      // or "telephone"
```

`appointmentType` uses the standard v2-0276 codes (`ROUTINE`, `FOLLOWUP`).
Cancelled appointments have `status: "cancelled"` and `cancelationReason`
(R4 spelling).

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
| 400 | Bad search param/value, invalid resource body, id mismatch |
| 401 | No clinic credentials |
| 404 | Unknown clinic, unknown resource type, or resource not found |
| 406 / 415 | Non-JSON `_format` / wrong `Content-Type` |
| 409 | Concurrent modification (retry) |
| 412 | `If-Match` version is stale |
| 501 | The clinic's EHR doesn't support this interaction |
| 502 | The EHR failed or returned something that isn't valid R4 |
| 503 / 504 | The EHR is rate limiting or timed out |

If the EHR returns an invalid resource inside a search, that entry is left
out and reported in an `OperationOutcome` entry (`search.mode = outcome`).
It is never silently dropped.
