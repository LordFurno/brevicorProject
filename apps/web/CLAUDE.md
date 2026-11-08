# apps/web — frontend (patient booking, waiting room, physician console)

Owned by the frontend dev. Teammates: don't edit files here without a heads-up, and vice versa.

## Rules
- Patients never have accounts. Identity = secret invite link + date of birth → per-visit signed cookie.
- Physicians sign in with Supabase Auth. Clinic and FHIR Practitioner come from
  their current physician memberships, never the booking directory or email lookup.
- Vendor SDKs only inside their folder: `twilio`/`twilio-video` only in `src/comms/twilio/`.
  Pages and components use `src/comms/types.ts` + `loadCommsClient()` / `getCommsServer()`.
- Clinical data only through `src/lib/clinical` (`loadChart`). Never call an EHR or Supabase tables directly for chart data.
- Every visit query is tenant-scoped (`clinicId`) and ownership-checked (`ownsVisit`).
- No patient names or other PHI in logs, browser notifications, document titles or video identities.
- Ending a call never touches the FHIR Encounter.
- Persistent visits contain references and activity state, never demographics or
  raw invite tokens. Display data is fetched per request from FHIR with the caller's
  token; patient/sync calls use the internal service token and explicit clinic.
- Supabase is the default visit/photo store. State changes and events are atomic;
  notification failures cannot roll back a visit. Memory is development/test only.
- Photo history uses clinic + FHIR patient_ref across treating physicians. The
  current visit's ownership check authorizes access; patients stay visit-scoped.
- `/book` is a separate development-only memory preview behind BOOKING_ENABLED.
- The dashboard re-syncs EHR appointments; it never resets EHR or activity data.

## Commands (run inside apps/web)
- Dev: `npm run dev`
- Typecheck: `npm run typecheck`
- Build: `npm run build`
- Tests: `npm test` (no real notifications)
- Sync: `npm run visits:sync -- <clinicId>`
