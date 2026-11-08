# Brevicor Web (patient + physician frontend)

Next.js app for booking video visits, the virtual waiting room, and the physician
console (dashboard + consultation room with the patient's chart side by side).

## Run it

```bash
cd apps/web
npm install
cp .env.example .env.local   # optional — everything works with defaults
npm run dev                  # http://localhost:3000
```

Use `npm run dev:https` to test from a phone on your LAN (camera access needs https).

## 2-minute demo

1. Go to `/doctor/login` and click **Dr. Amelia Chen** under *Demo accounts*.
2. The dashboard shows seeded patients: two already in the waiting room, plus **Priya Raman**, who is booked for now.
3. Click the link icon on Priya's row to copy her visit link. Open it in a **new tab of the same browser** and enter DOB `1993-06-21`.
4. Priya now appears in the waiting room (you'll hear a chime). Click **Call in**.
5. You get a live video call: the patient's video on the left and her chart (allergies, meds, labs, past visits) on the right.
6. **End visit** disconnects both sides.

You can also book a new visit at `/book` and open the confirmation link.
**Reset demo** at the bottom of the dashboard re-seeds the data around the current time.

## Where things live

| Path | What |
|---|---|
| `src/app/` | Routes. `book/`, `visit/[token]/` (patient), `doctor/` (physician), `api/` |
| `src/components/` | UI. `booking/`, `visit/` (waiting room), `doctor/` (dashboard, consult room, chart), `video/` |
| `src/comms/` | **Swappable video provider.** `types.ts` is the contract; `twilio/` and `local/` implement it |
| `src/lib/clinical/` | **Seam to the FHIR gateway.** `mock-source.ts` (now) / `fhir-source.ts` (later), both use `map.ts` |
| `src/lib/visits/` | Appointment/session state. `store.ts` is in-memory; swap for Supabase |
| `src/lib/directory.ts` | Clinics + physicians (static for now; later FHIR Organization/Practitioner) |
| `src/lib/auth/` | Physician sign-in (Supabase or demo) and patient visit cookies |

## Switching the video provider

* `COMMS_PROVIDER=local` (default): free, with no account needed. Real peer-to-peer WebRTC between two tabs of the same browser. Good for demos on one laptop.
* `COMMS_PROVIDER=twilio`: set `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID` and `TWILIO_API_KEY_SECRET` (Console → API keys). Works across devices.

To add another provider (Daily, LiveKit, Vonage…), implement `CommsServerProvider` and `CommsClient`
in `src/comms/<name>/` and register them in `src/comms/server.ts` and `src/comms/client.ts`.
No page or component changes are needed.

## Connecting the real clinic data

Set `CLINICAL_SOURCE=fhir`, `FHIR_BASE_URL` and `FHIR_API_KEY`. The app then searches the gateway for
`Patient` (by OHIP identifier, then by family name + birthdate), followed by `Condition`, `AllergyIntolerance`,
`MedicationStatement`, `Observation`, `Encounter` and `DocumentReference` for that patient.
If a search fails, the chart shows an "unavailable" banner and the visit continues.

## Known limitations (MVP)

* Visit state is in memory, so it resets on restart and won't work across Vercel serverless instances. Implement `VisitStore` on Supabase before deploying.
* Invitation links are shown on screen rather than emailed/texted (see `TODO(notifications)` in `lib/visits/service.ts`).
* Waiting-room updates use 3-second polling. Supabase Realtime is a drop-in upgrade.
* Transcription and phone (PSTN) calls are not built yet.
