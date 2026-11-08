# Notification service

Texts physicians when a patient is waiting and they're not in the app, and
sends patients their visit invitations, cancellations and reschedules. The
spec says SMS and email; today only SMS has a real provider (Twilio), and
email goes to a console logger.

It lives in the root app: `lib/notify/` (service, providers, templates),
`app/api/notify/v1/` (routes), and `supabase/migrations/20261110000000_notifications.sql`.

Rules it follows (from `CLAUDE.md`):

- **No patient-identifying information in any message or log.** Templates
  accept only a clinic display name, an appointment time, video/phone and a
  link. They have no field for a name, visit reason or date of birth.
- **Contact details come only from FHIR.** A patient's phone and email are read
  from `Patient.telecom` through our own FHIR API. The API rejects any request
  that includes them.
- **Providers sit behind an interface.** Twilio is imported only in
  `lib/notify/providers/twilio-sms.ts` (and in the frontend's
  `apps/web/src/comms/twilio/`).

## Setup

### 1. Twilio (trial account)

1. **Account SID:** in the [Twilio Console](https://console.twilio.com), copy
   the Account SID (`AC…`) from the dashboard.
2. **API key:** go to Account → API keys & tokens → Create API key (Standard).
   Copy its SID (`SK…`) and secret. The secret is shown only once. The service
   uses the API key, not the account's auth token.
3. **Sending number:** go to Phone Numbers → Manage → Buy a number. A trial
   account gets one SMS-capable number for free.
4. **Recipients:** on a trial account, verify every number you want to text
   under Phone Numbers → Manage → Verified Caller IDs. A message to any other
   number fails with **21608**. The service reports that code with a hint
   instead of throwing.
5. **Countries:** under Messaging → Settings → Geo permissions, make sure
   Canada (and the US, if you need it) is enabled.

**Trial accounts can't send our text.** Current Twilio trials reject any custom
message body with error **572006**. They accept only the *name* of one of
Twilio's predefined templates (`sms_appointment_reminders`,
`sms_internal_alerts`, …) as the body, and the recipient sees Twilio's own
sample text for it ([trial SMS docs](https://www.twilio.com/docs/usage/trials/try-out-sms)).
To still exercise the whole pipeline on a trial, set
`TWILIO_TRIAL_TEMPLATES=true`:
- **What gets sent:** the SMS provider sends `sms_internal_alerts` for
  `patient_waiting` and `sms_appointment_reminders` for the visit messages,
  instead of our text.
- **How it's recorded:** those deliveries show `provider: "twilio-trial"`.

Everything else is real: authentication, the FHIR lookup, dedupe, rate limits,
Twilio delivery and the log. Upgrading the account lifts the restriction, after
which our own templates go out unchanged. Leave the flag off in any real
deployment.

### 2. Environment (`.env.local`)

| Variable | Default | |
|---|---|---|
| `NOTIFY_SMS_PROVIDER` | `console` | `twilio` or `console`. `twilio` with any credential missing falls back to `console`, with a warning. |
| `NOTIFY_EMAIL_PROVIDER` | `console` | `console` is the only one for now. |
| `TWILIO_ACCOUNT_SID` | | `AC…` |
| `TWILIO_API_KEY_SID` | | `SK…` |
| `TWILIO_API_KEY_SECRET` | | Server-side only. Never logged or printed. |
| `TWILIO_SMS_FROM` | | The Twilio number (E.164), or a Messaging Service SID (`MG…`). |
| `TWILIO_TRIAL_TEMPLATES` | off | `true` on a Twilio **trial** account only: sends Twilio's predefined templates instead of our text (see above). |
| `APP_BASE_URL` | (required) | The frontend's URL, e.g. `http://localhost:3000`. Every link in a notification must be under it. |
| `NOTIFY_ONLINE_WINDOW_SECONDS` | `60` | A physician seen this recently counts as online and gets no SMS for `patient_waiting`. |
| `NOTIFY_MAX_PER_HOUR` | `20` | Maximum messages per recipient per clinic, over a rolling hour. |
| `DEMO_PHYSICIAN_PHONE` | | For `notify:contacts`. A number **you control** (and have verified on the trial account), E.164 or 10-digit North American. |
| `INTERNAL_SERVICE_TOKEN` | (required) | Already used by the FHIR API. Events are authenticated with it, and `recipient_key` is derived from it. |

Tests always use the console providers, whatever `.env.local` says
(`tests/setup.ts`).

### 3. Database and demo data

```bash
npm run db:push            # physician_contacts, notification_log, ehr_connections.display_name
npm run fhir:users         # if you haven't: the demo physicians
npm run notify:contacts    # gives them DEMO_PHYSICIAN_PHONE in each clinic where they are a physician
```

### 4. Send a real one

With `npm run dev` running:

```bash
npm run notify:test -- patient_waiting                           # to DEMO_PHYSICIAN_PHONE
npm run notify:test -- visit_invitation                          # to the first patient with a phone today (DEMO_PHONE_NUMBERS)
npm run notify:test -- visit_invitation --clinic demo-clinicsoft # same patient, through the adapter
npm run notify:test -- visit_invitation --dedupe-key <key printed above>   # sends nothing
```

The script prints each delivery's status, masked recipient, provider and
message id (or error code and hint). Options: `--clinic` (default `demo-mock`),
`--dedupe-key`, `--api` (default `http://localhost:3000`, the root app). The
invitation link it sends is a placeholder: frontend visits aren't linked to
FHIR appointments yet. The visit scripts need appointments seeded today
(`npm run fhir:reset -- demo-mock`).

## API

Base: `/api/notify/v1`. Errors are FHIR `OperationOutcome`s, as in the FHIR API.
A failed delivery is **not** an error: it comes back in a 200 response.

### `POST /events`

Server-side callers only: `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>` plus
`X-Clinic-Id`. A physician token gets 403.

```json
{
  "type": "visit_invitation",
  "dedupeKey": "visit_invitation:v_3f2a9c",
  "appointmentRef": "Appointment/123",
  "patientRef": "Patient/456",
  "link": "https://app.example/visit/<invite token>"
}
```

| `type` | Goes to | Needs | Text |
|---|---|---|---|
| `patient_waiting` | the physicians linked to the Practitioner (`clinic_members.practitioner_ref` → `physician_contacts`) | `practitionerRef`, or `appointmentRef` (its Practitioner participants), plus `link` | "Brevicor: a patient is waiting in your virtual waiting room. {link}" |
| `visit_invitation` | the Appointment's patient | `appointmentRef`, `link` | "Demo Clinic: your video visit is on Tue, Nov 10 at 3:30 p.m. Join: {link}" |
| `visit_rescheduled` | the Appointment's patient | `appointmentRef`, `link` | "...your video visit has moved to {new time} Join: {link}" |
| `visit_cancelled` | the Appointment's patient | `appointmentRef` (`link` optional) | "...your video visit on {time} has been cancelled." |

- **Patient-facing messages:**
  - **Contact details:** the phone comes from `Patient.telecom`, preferring
    `use=mobile` and never `use=old`. The email is the first `system=email`.
    Both are read through the FHIR API with the service token, so this works
    for any clinic's EHR.
  - **Time and video/phone:** come from the FHIR Appointment (`start`, and the
    `serviceType` modality coding).
  - **Clinic name:** `ehr_connections.display_name`, or "Brevicor" when it isn't
    set.
  - **`patientRef`:** optional, but if you send it, it must be a participant of
    the Appointment (400 otherwise).
- **`dedupeKey`:** 1–128 characters from letters, digits and `. _ : -`. Build
  it from ids, never from names (e.g. `patient_waiting:<visitId>`).
- **`link`:** must be under `APP_BASE_URL`: same scheme, host and port, and a
  path inside the base path. Anything else gets 400, so this endpoint can't be
  used to text arbitrary links.
- **Unknown fields:** any field not shown above (e.g. `phone`, `to`) gets 400.

Response (200):

```json
{
  "type": "visit_invitation",
  "dedupeKey": "visit_invitation:v_3f2a9c",
  "deduplicated": false,
  "results": [
    { "channel": "sms", "status": "sent", "recipient": "+1******0123", "provider": "twilio", "providerMessageId": "SM…", "errorCode": null },
    { "channel": "email", "status": "skipped", "recipient": null, "provider": null, "providerMessageId": null, "errorCode": "no_recipient", "detail": "No contact on file for this channel." }
  ]
}
```

| `status` | Meaning |
|---|---|
| `sent` | The provider accepted the message. That isn't proof of delivery: Twilio delivery callbacks aren't wired up yet. |
| `failed` | `errorCode` says why: `twilio:<code>` (e.g. `twilio:21608`, unverified on a trial account; `twilio:572006`, custom text on a trial account), `fhir:<Type>:<status>`, `store_unavailable`, `provider_error`, `config:unknown_provider`. |
| `skipped` | Nothing was sent, on purpose: `no_recipient`, `invalid_recipient`, `online`, `rate_limited`, `no_patient`. |
| `sending` | Only while another request is mid-send with the same key. |

`detail` is fixed text we write. It is never the provider's error message,
because Twilio's messages can include the recipient's number.

Request errors: 401 (no or invalid token), 403 (not a service caller), 404
(unknown clinic), 400 (validation), 409 (`dedupeKey` already used for a
different `type`), 415 (not JSON), 503 (database unavailable; nothing was sent).

### `POST /presence`

A signed-in physician's heartbeat: `Authorization: Bearer <Supabase access token>`,
plus `X-Clinic-Id` if they belong to several clinics. It updates
`physician_contacts.last_seen_at`. A physician seen within
`NOTIFY_ONLINE_WINDOW_SECONDS` gets no SMS for `patient_waiting`, because the
in-app alert covers them. Until the frontend sends this heartbeat, every
physician counts as offline, so the SMS always goes out.

Response: `{ "lastSeenAt": "…", "onlineWindowSeconds": 60 }`.

## Behaviour

- **Each event runs at most once per recipient and channel.** The unique key
  is `(clinic_id, dedupe_key, channel, recipient_key)`. A repeated `dedupeKey`
  returns the existing log entries with `deduplicated: true` and sends nothing,
  without even reading FHIR.
  - **Concurrent requests:** each delivery's log row is inserted (as
    `sending`) *before* the provider is called. Only the request whose insert
    succeeds sends, so a burst of waiting-room heartbeats sends one message.
  - **Failures and skips count:** a `failed` or `skipped` delivery also uses up
    the key, so a heartbeat can't retry a failure every few seconds. To retry
    on purpose, send a new key.
- **Rate limit:** `NOTIFY_MAX_PER_HOUR` per recipient per clinic. Past it, the
  delivery is `skipped` with `rate_limited`. Two requests at the same instant
  can overshoot the limit by one.
- **Failures don't throw.** Provider errors, FHIR read errors and unusable
  contacts all come back as per-delivery results. One channel failing doesn't
  stop the other.
- **Database outage:** if the log can't be written, nothing is sent, because
  without the log row there's no duplicate protection.

## Data

Both tables are server-only: RLS is on and nothing is granted to `anon` or
`authenticated`.

- **`physician_contacts(user_id, clinic_id, phone, email, channels, last_seen_at)`**
  - One row per clinic membership; deleting the membership deletes the row.
  - `phone` is E.164. `email` is stored but not used yet. `channels` defaults
    to `{sms}`.
- **`notification_log(id, clinic_id, type, channel, provider, recipient_masked, recipient_key, status, provider_message_id, error_code, dedupe_key, created_at, updated_at)`**
  - **Never a message body or a full recipient.**
  - `recipient_masked` (`+1******0123`) is for people to read.
  - `recipient_key` (an HMAC of the address, or `none`) is for dedupe and rate
    limiting.
  - There's no retention job yet.
- **`ehr_connections.display_name`:** the clinic name patients see. It's set to
  "Demo Clinic" for `demo-mock` and `demo-clinicsoft`.

## Privacy and data residency

- Message text contains a clinic name, a time and a link. There are no names,
  reasons, dates of birth or other patient details.
- Logs (`notify.request`, `notify.console`) record the clinic, caller, type and
  per-delivery status codes. The console provider adds a masked recipient and
  the template id, never the body.
- Supabase (`ca-central-1`) holds the log and contacts.
- **Twilio is outside Canada.** Twilio has no Canadian region, and its message
  logs, including the recipient's number and the message text, are stored in
  the US. That text includes the invitation link; the link still requires the
  date-of-birth check. Before production, this needs the PHIPA third-party
  review the spec calls for (§3), including Twilio's data retention and
  redaction options. The same applies to whichever email provider is chosen.

## Wiring up the frontend (later)

`apps/web` is out of scope for this change. These are the two calls it should
add.

**Prerequisite: visits must carry FHIR references.** The service only sends to
contacts it reads from FHIR. A visit therefore needs the FHIR
`appointmentRef` and the physician's `practitionerRef`, plus `patientRef` where
it's known. Today `apps/web` visits hold the booking form's details, and their
`practitionerId` is a frontend directory id. Adding the references is part of
the upcoming FHIR–frontend integration. Until then, a visit someone books
themselves in `apps/web` can't be notified: by design there is no fallback that
accepts contact details from the caller.

A server-side helper (it reuses the frontend's existing FHIR service-token
settings):

```ts
// apps/web/src/lib/notify.ts (server-only)
export async function notify(event: Record<string, string>) {
  try {
    await fetch(`${process.env.NOTIFY_API_URL}/events`, {   // e.g. http://localhost:4000/api/notify/v1
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.FHIR_API_KEY}`,  // the gateway's INTERNAL_SERVICE_TOKEN
        'X-Clinic-Id': process.env.FHIR_CLINIC_ID!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // A notification must never break booking or check-in.
  }
}
```

**1. `visit_invitation`:** at `TODO(notifications)` in
`apps/web/src/lib/visits/service.ts` (`createBooking`, ~line 192), after
`store.insert(visit)`:

```ts
after(() =>   // from 'next/server': runs after the response, so booking isn't slowed down
  notify({
    type: 'visit_invitation',
    dedupeKey: `visit_invitation:${visit.id}`,
    appointmentRef: visit.appointmentRef,          // added by the FHIR-frontend integration
    link: `${APP_BASE_URL}/visit/${visit.inviteToken}`,
  }),
);
```

**2. `patient_waiting`:** in `checkInAndGetStatus()`, only when this check-in
first moves the visit to `'waiting'` (the patient's heartbeat repeats every few
seconds):

```ts
const firstArrival = v.status !== 'waiting';
await store.update(v.id, { status: 'waiting', waitingSince, lastSeenAt: iso(now) });
if (firstArrival) {
  after(() =>
    notify({
      type: 'patient_waiting',
      dedupeKey: `patient_waiting:${v.id}`,
      practitionerRef: v.practitionerRef,          // the physician's FHIR Practitioner
      appointmentRef: v.appointmentRef,
      link: `${APP_BASE_URL}/doctor`,
    }),
  );
}
```

The `dedupeKey` makes repeats harmless anyway, but calling only on the first
change avoids a request every few seconds. Cancellations and reschedules follow
the same pattern, with `visit_cancelled:<visitId>` and
`visit_rescheduled:<visitId>:<new start>`. The new start time keeps a second
reschedule from being treated as a duplicate.

The physician console should also send `POST /presence` with the physician's
Supabase token every ~20–30 seconds while it's open. That stops online
physicians getting texted for patients they can already see.

## Adding an email provider

1. Add `lib/notify/providers/<name>.ts` exporting a function that returns a
   `NotificationChannel` with `channel: 'email'`. It sends `subject` and `text`
   (and `html` if you add it to the templates). It throws `DeliveryError(code,
   detail)` on failure, where `detail` is your own text, never the provider's.
2. Register it in `EMAIL_PROVIDERS` in `lib/notify/providers/index.ts` (one
   line; import it dynamically, as `twilio` is).
3. Set `NOTIFY_EMAIL_PROVIDER=<name>`, plus the provider's credentials.
4. Check where it stores data. Prefer a provider with Canadian storage, or
   record the residency decision.

Physician email also needs `physician_contacts.channels` to include `email` and
an `email` value. Patients get email wherever `Patient.telecom` has one.

## Known limitations

- **A `patient_waiting` skipped as `online` uses up the key.** If the physician
  goes offline afterwards, they aren't texted for that patient.
- **`recipient_key` is derived from `INTERNAL_SERVICE_TOKEN`.** Rotating the
  token resets dedupe and rate-limit history: an old `dedupeKey` could send
  again, and hourly counts start over.
- **Deliveries aren't retried.** A failure is final for that key. A process
  that dies mid-send leaves the row as `sending`, so it is never resent (better
  a missed text than a double one).
- **`sent` means the provider accepted the message,** not that it was
  delivered. Twilio status callbacks (with signature verification, spec §4I)
  aren't implemented.
- **No retention job** for `notification_log` yet.
- **Patients' email goes to the console provider** until a real email provider
  is added.
- **On a Twilio trial, recipients see Twilio's sample text,** not ours (with
  `TWILIO_TRIAL_TEMPLATES=true`; without it, sends fail with 572006). Our
  wording reaches phones only after the account is upgraded.
