# Team workflow: who owns what

Three people work in one repo. Each person owns a separate folder with its own `package.json`
and lockfile, so normal work never touches the same files.

| Area | Folder | Owner |
|---|---|---|
| Frontend: booking, waiting room, physician console, video | `apps/web/` | Frontend dev |
| FHIR gateway (EHR Integration Layer) | `apps/fhir-gateway/` (suggested) | Gateway dev |
| Supabase schema, mock clinical data, migrations | `supabase/` | Data dev |
| Shared docs and specs | `docs/`, root `CLAUDE.md` | Everyone, in small PRs |

## Rules that prevent conflicts
1. **Stay in your folder.** If you need a change in someone else's folder, ask them or open a PR they review.
2. **No root `package.json` or root lockfile.** Each app installs its own dependencies (`cd apps/web && npm install`).
3. **Branch per person and feature:** `web/waiting-room`, `fhir/patient-search`, `db/seed-v2`. Never commit straight to `master`.
4. **Pull before you push:** `git pull --rebase origin master`, then push your branch and open a PR.
5. **Never commit secrets.** Use `.env.local` (gitignored). Keep `.env.example` up to date.
6. **Line endings** are normalised by `.gitattributes`, so Windows and macOS users won't make whole-file diffs.

## Integration contracts (the only places our code meets)
- **Frontend → FHIR gateway:** HTTP only. `apps/web` calls `FHIR_BASE_URL` with `Authorization: Bearer <FHIR_API_KEY>`.
  It uses `Patient`, `Condition`, `AllergyIntolerance`, `MedicationStatement`, `Observation`, `Encounter` and `DocumentReference`.
  See `apps/web/src/lib/clinical/fhir-source.ts`.
- **Frontend → Supabase:** physician Auth (email/password). Later, a `visits` table that implements
  `VisitStore` (`apps/web/src/lib/visits/store.ts`). The data dev owns the migration; the frontend dev owns the adapter.
- **Matching patients:** bookings carry name, date of birth and (optionally) an Ontario health card number.
  The gateway should support `Patient?identifier=<ohip>` and `Patient?family=<name>&birthdate=<yyyy-mm-dd>`.
