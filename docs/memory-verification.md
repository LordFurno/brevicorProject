# Persistent memory verification

Verified November 8, 2026, using the linked Supabase project, root gateway on port
4000 and two independent production frontend processes on ports 3001 and 3002.
Port 3000 was already in use and its process was left running.

## Initial synchronization

Both `demo-mock` and `demo-clinicsoft` returned:

```json
{"created":17,"rescheduled":0,"cancelled":0,"updated":3,"ignored":0,"unavailable":0}
```

Each clinic has 20 EHR-backed visits, including three already-cancelled appointments
which were not invited. No frontend demo visits were seeded.

The first SMS attempts were rejected with `twilio:572006`. After configuring the
existing `TWILIO_TRIAL_TEMPLATES=true` support, explicit invitation retries with
fresh keys were accepted. Trial recipients receive Twilio sample text, not Brevicor
invitation wording or links. `sent` means accepted by Twilio, not confirmed delivered.

| Clinic | Invitation retry | First waiting notification |
| --- | --- | --- |
| demo-mock | sent · twilio-trial · `SM33020feaaa89a74ebbe2c1bfb0f2d710` | sent · twilio-trial · `SM1d135389a08cc726c8b7bf5519716ef1` |
| demo-clinicsoft | sent · twilio-trial · `SMa89e4c973f4cf082ed2c747714ef85dd` | sent · twilio-trial · `SMcac2411c6cd8f46e276ea966978efbe5` |

Other appointments without FHIR contact details were skipped with `no_recipient`.
Patient email uses the existing console provider.

## Patient/physician and restart flow

For each clinic, the live script used a real Supabase physician login and selected
membership, opened a fresh invitation, read the synthetic DOB through the gateway,
verified it, and checked in through frontend instance one. Instance two immediately
reported that visit as waiting. The physician admitted the patient, and the patient
received local video join credentials.

A subsequent link rotation rejected the old invitation while the already joined
patient's status remained `in_call`. A synthetic PNG was uploaded to Cloudinary via
that call session, then read and annotated through the other frontend.

Both frontend processes were stopped and restarted. The verification script then
returned:

```json
{"clinic":"demo-mock","restart":"passed","visit":"persisted","photos":1,"originalEventsPreserved":15,"ended":true}
{"clinic":"demo-clinicsoft","restart":"passed","visit":"persisted","photos":1,"originalEventsPreserved":15,"ended":true}
```

The same visit IDs, uploaded photo IDs, saved notes and all 15 original audit-event
IDs remained. Both communication sessions ended successfully after verification.
FHIR Encounter status was not changed. This checks HTTP/session/media-credential
behavior; it does not claim a browser camera-to-camera WebRTC call was exercised.

## Automated checks

Root: 412 tests passed, with the optional native HAPI test skipped because no HAPI
instance was configured. Frontend: 59 tests passed, including real-Supabase fixtures for concurrent
upserts, verification limits, first check-in, durable photo notes, cross-physician
history, clinic isolation and denied anonymous reads/RPC execution. Test fixtures
use isolated clinics and are removed afterward; automated tests do not send SMS.
Generated clinic-scoped video and phone links are checked against the existing
GSM-7 templates and 160-character limit for the normal production frontend URL.

Final production smoke checks returned HTTP 200 dashboards in both clinics,
accepted real physician logins and clinic switching, rejected the staff-only HAPI
clinic, revoked old invitations, and accepted the same session on the second
frontend. Both live presence probes returned SMS `skipped:online`; no SMS was
sent by those probes. Booking and unauthenticated physician/cron gates also passed.

The final secret scan found no configured credentials in 83 reviewable files or
59 generated browser artifacts. Environment files remain ignored.

The installed-schema assertions passed: no demographic/raw-token columns, RLS on
all three memory tables, and no public table or mutation-function grants.
Both application builds and typechecks passed. The schema verification command is
documented in `apps/web/README.md`; rerun it after any migration change.
