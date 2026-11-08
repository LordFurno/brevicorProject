# apps/web — frontend (patient booking, waiting room, physician console)

Owned by the frontend dev. Teammates: don't edit files here without a heads-up, and vice versa.

## Rules
- Patients never have accounts. Identity = secret invite link + date of birth → per-visit signed cookie.
- Physicians sign in (Supabase Auth, or demo accounts when Supabase env is unset).
- Vendor SDKs only inside their folder: `twilio`/`twilio-video` only in `src/comms/twilio/`.
  Pages and components use `src/comms/types.ts` + `loadCommsClient()` / `getCommsServer()`.
- Clinical data only through `src/lib/clinical` (`loadChart`). Never call an EHR or Supabase tables directly for chart data.
- Every visit query is tenant-scoped (`clinicId`) and ownership-checked (`ownsVisit`).
- No patient names or other PHI in logs, browser notifications, document titles or video identities.
- Ending a call never touches the FHIR Encounter.

## Commands (run inside apps/web)
- Dev: `npm run dev`
- Typecheck: `npm run typecheck`
- Build: `npm run build`
