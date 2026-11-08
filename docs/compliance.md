# Services, data and PHIPA notes

Every external service the repository uses or configures, what personal
health information (PHI) it can touch, and where that data is stored or
processed. Written November 8, 2026 from the code on branch `clinical`.

**This is an engineering inventory, not legal advice.** "Verified" means checked
on that date as stated; everything else is from the code or vendor knowledge and
is marked *unverified*. PHIPA (Ontario) requires health information custodians
to protect PHI and to have written agreements with the agents and electronic
service providers that handle it (e.g. PHIPA s.17 and O. Reg. 329/04 s.6).
CLAUDE.md adds a project rule: **all stored data stays in Canada.**

| Service | Used for (where in the repo) | PHI it can touch | Stored / processed | PHIPA notes and open items |
|---|---|---|---|---|
| **Supabase** (Postgres, Auth, Data API) | FHIR mock EHR (`fhir_resources`), the Brevicor docstore (`fhir_docstore`), the ClinicSoft fake EMR (schema `clinicsoft`), visit memory (`visits`, `visit_events`, `visit_photos`), notifications (`notification_log`), physician accounts and `clinic_members` | Clinical resources (synthetic in the demo; in production the docstore holds real Encounters and DocumentReferences, including photo diagnosis and notes); photo notes and diagnosis; FHIR references; masked recipients and HMAC keys; physician emails | **ca-central-1 (Canada). Verified** with `supabase projects list` (project `Brevicor`). | RLS on every table; only the server's secret key reads or writes; no anon/authenticated grants (`tests/sql/memory-schema.sql` checks the memory tables). **Open:** backup/PITR and log locations (*unverified*, assumed in-region); whether Auth emails go through Supabase's default SMTP and where (*unverified*); a signed data-processing/agent agreement covering PHIPA. Storage buckets aren't used. |
| **Vercel** (hosting, serverless functions) | Root gateway app (`vercel.json`: `"regions": ["yul1"]`, Montréal) and the frontend `apps/web` | All PHI passes through functions in transit: chart reads, clinical writes, photo bytes streamed by `/api/media/photos/*` | Root app functions: **yul1** (configured in the repo; deployed setting *unverified*). **`apps/web` has no `vercel.json` and no `preferredRegion`, so its functions run in the Vercel project's default region, likely the US** (*unverified*). Static assets go out through Vercel's global CDN. Runtime and build logs: Vercel-hosted, region *unverified* (likely US). | **Open (high):** pin `apps/web` functions to `yul1`, or confirm the project setting. Application logs are designed to hold no PHI (`lib/fhir/log.ts`, chart and visit code log only status codes), so log location matters less, but needs confirming. Agreement covering PHIPA: *open*. |
| **Twilio Programmable Video** | Video consultations (`apps/web/src/comms/twilio/`) | Live audio and video of the consultation; room names and participant identities (no names, by rule) | Twilio media servers; region selection isn't set in code (Twilio's default automatic routing). Account data is US-hosted (*unverified*). No Canadian Video media region is known (*unverified*). | Recording is off (no `recordParticipantsOnConnect`; rooms are ended by `endRoom`). Media is transient but processed outside Canada. **Open:** confirm media routing and region; agreement/BAA; whether this meets the clinic's PHIPA risk assessment. |
| **Twilio Programmable Messaging (SMS)** | Patient invitations and physician alerts (`lib/notify/providers/twilio-sms.ts`, `twilio-trial` templates) | Patient and physician phone numbers (from FHIR `Patient.telecom` / physician contacts); message text holds only clinic name, time, modality and link, never names, reasons or DOB (`lib/notify/templates.ts`) | Twilio (US-hosted message logs, *unverified* retention) | Brevicor stores only masked recipients and HMAC keys. Provider errors are rewritten so numbers never reach our logs. The demo uses a trial account with Twilio's predefined templates. **Open:** Twilio message-log retention/redaction setting; agreement. |
| **Twilio Voice** | Phone consultations (build-order step 4) | Call audio and phone numbers | Not built: no Voice code in the repo | Assess before building. |
| **Cloudinary** | Consultation photos: patient uploads and in-call captures, enhancement transforms, face blur (`apps/web/src/media/`, `components/cloudinary/`) | **Patient photos (PHI).** Notes and diagnosis stay in Supabase, not Cloudinary. | Cloudinary's storage region for this account is *unverified*. Cloudinary's standard data centres are US, EU and Asia-Pacific; **no Canadian region is known** (*unverified*). Transforms run on Cloudinary. | This branch makes assets **authenticated** (private) under random ids (`brevicor/<uuid>`, no patient/visit/clinic data and no file name), signs uploads on the server (secret server-only), and serves the browser only 5-minute Brevicor URLs; Cloudinary URLs never leave the server. **Open (high):** the Canada-only storage rule is not met unless the account's region is Canadian. Options: a Canadian region if Cloudinary offers one, or Supabase Storage (ca-central-1) with server-side processing. **Open:** photos uploaded before this branch used the unsigned preset and are public `upload` assets (synthetic demo images): delete or convert them. Server-side credentials are configured and the private flow was verified live. Agreement: *open*. |
| **HAPI FHIR public test server** (`hapi.fhir.org`) | The `hapi-public` clinic connection (read-only, staff-only), a native-FHIR demo (`supabase/migrations/20261107120000_fhir_gateway.sql`) | Anything sent to it is public: search values (names, birth dates, identifiers) would be disclosed | US, public internet | Read-only, so no writes are ever sent; the docstore fallback keeps any create local. **Open:** never connect real users to it, and remove the connection outside development, since search criteria leave Canada and become public. Conformance runs against a local Docker HAPI, not this server. |
| **AWS Transcribe Medical** | Consultation transcription (spec; `TranscriptionProvider`) | Consultation audio and transcripts | Planned for **ca-central-1**. Not built: no code in the repo. | Spec requires deleting raw audio after transcription, and transcripts are "unverified" until physician review. |
| **Email notifications** | Patient email channel (`lib/notify/providers/`) | Patient email addresses | Console provider only: nothing is sent | Choose a Canadian-hosted provider, or assess one, before enabling. |
| **Google Fonts** via `next/font/google` (Inter) | Frontend typography (`apps/web/src/app/layout.tsx`) | None | Font files are fetched at build time and self-hosted by Next.js; browsers make no runtime request to Google (Next.js behaviour, *unverified for this deployment*) | No PHI. |
| **GitHub** | Source code (`origin`) | None. Environment files are git-ignored; secret scans are recorded in `docs/memory-verification.md`. | US | Keep real data and secrets out of the repository. |
| **Synthea** | Synthetic demo patients (`synthea-output/`, run locally) | None real: all demo data is synthetic. Demo health card numbers deliberately fail the Ontario check digit (`scripts/lib/hcn.ts`). | Local | Generated data only. |

## Cross-cutting controls in the code

- **No PHI in logs or messages.** Gateway logs carry ids, counts and status
  codes (`lib/fhir/log.ts`). Chart and write-back failures log only HTTP status
  codes (`gateway:<status>`). SMS templates take no name, reason or DOB.
- **Tenant scoping.** Every gateway query is scoped by the verified caller's clinic
  (`resolveCaller`); the docstore and visit memory are clinic-scoped and
  server-only.
- **No silent data loss.** Writes an EHR can't take go to the docstore in
  Supabase (Canada), tagged `local-only`, and stay visible in that clinic's chart.
- **Photos.** Private Cloudinary assets, server-signed uploads, 5-minute
  Brevicor URLs that also require a signed-in physician of the photo's clinic,
  and a chart link that opens only for those physicians. Verified against real
  Cloudinary on November 8, 2026 (`docs/memory-verification.md`).

## Open items (summary)

1. Pin `apps/web` Vercel functions to `yul1` and confirm both projects' regions and log locations.
2. Cloudinary storage region vs the Canada-only rule; delete or convert pre-hardening public assets; add the server-side Cloudinary credentials.
3. Twilio Video/SMS processing outside Canada: document it in the privacy impact assessment, or choose regional options.
4. Remove the `hapi-public` connection outside development.
5. Written agreements (PHIPA agents / electronic service providers) with each vendor that handles PHI.
6. Supabase backups and Auth email delivery locations.
