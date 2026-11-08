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


## Cloudinary photo tools

The physician consultation room has **Patient chart** and **Photos & notes** panels.
In Photos & notes, upload a JPEG/PNG/WebP/AVIF photo (up to 20 MB), or capture the
connected patient's live video. Original colors, gentle clarity, sharpening, color
balance, lesion zoom, manual pan, face blur, annotations, and wound-outline tracing
reuse the original Cloudinary starter project's image processing.

Set NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME and NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET in
apps/web/.env.local (see .env.example), then restart npm run dev. The preset must
be Unsigned in Cloudinary. No Cloudinary API secret is needed or exposed.

Low-data photos use q_auto:eco and a 640px maximum edge instead of 1280px; f_auto
selects a browser-compatible format. Original uploads are retained. This setting
does not change video-call bandwidth or initial upload size.

Notes and photo history are session-only, not attached to FHIR records. Leaving or
reloading the consultation clears that local history, but does not delete uploaded
Cloudinary assets. This integration does not modify any lib folder. Patient photos can be shared from the verified waiting room or live call. They
are available to the owning physician through authenticated visit-scoped routes.
Photo references use a bounded, 24-hour in-memory store, so use a single app server
for this demo. A persistent store is required for multiple production instances.
Persistent chart attachments still require additional backend work.

The original create-cloudinary-react starter remains in
cloudinaryFeatures/brevicortelemedicine for standalone development. Its dependencies
are separate; run npm install there to use its Vite UI. The repo-root TypeScript
project excludes this separate app.


### Selecting and capturing regions

In a live physician call, choose **Select region**, drag over the patient video,
then choose **Capture selected area**. **Clear region** restores full-frame capture.
The coordinates account for the visible video's center crop. Selection works with
mouse, touch, or pen. Each capture reads the currently displayed video and uploads
under a unique filename; wait for an upload to finish before capturing again.

For a saved image, use **Select photo region**, drag over the image, and choose
**Apply region**. **Show full photo** restores the original view without changing
the uploaded original.


## Camera submissions and longitudinal history

The waiting room's Take photo button captures the existing camera preview. Patients
review the still, retake/discard it, then Send to physician before the call.
Uploaded files use the same review step.

In the consultation's right panel, Photos & notes saves diagnosis/assessment and
notes per photo. Progress history groups original-color photos by meeting and
filters by weeks or number of meetings. It shows recorded observations, not an
automated healing score. Historical photos are scoped to the current clinic and
physician and matched on exact normalized patient name plus date of birth because
the current visit model does not expose a stable patient ID. Matching should use a
stable clinical patient ID before production.

Photo references and assessments currently use a temporary in-memory adapter in
src/media/visit-photos.ts. They reset when the app process restarts. Durable storage
is intentionally left for the backend teammate; the UI and authenticated routes are
ready to connect to that storage. Cloudinary stores uploaded image assets. No lib
files are modified, and photo notes do not write FHIR records. History only shows
photos submitted through this app; no old diagnoses or healing scores are invented.
