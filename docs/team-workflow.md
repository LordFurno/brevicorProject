# Team workflow: who owns what

Three people work in one repo. Each area has its own folder and its own `package.json`/lockfile,
so normal work never touches the same files.

| Area | Where | Install / run |
|---|---|---|
| FHIR gateway (EHR Integration Layer) | repo root: `app/`, `lib/`, `scripts/`, `tests/`, root `package.json` | `npm install`, `npm run dev -- -p 4000` |
| Supabase schema, migrations, mock data | `supabase/` | `npm run db:push` (from root) |
| Frontend: booking, waiting room, physician console, video | `apps/web/` (own `package.json`) | `cd apps/web`, `npm install`, `npm run dev` (port 3000) |
| Shared docs | `docs/`, root `CLAUDE.md` | small PRs, mention it in chat |

## Rules that prevent conflicts
1. **Stay in your area.** If you need a change in someone else's files, tell them or open a PR they review.
2. **Install where the `package.json` is.** Root deps belong to the gateway; frontend deps live in `apps/web`.
   Don't run `npm install` at the root to install frontend packages (it creates the wrong lockfile).
3. **Pull before you push:** `git pull --rebase origin master`, then push. Commit small and often.
4. **Never commit secrets.** Use `.env.local` (gitignored). Keep the `.env.example` files up to date.
5. **Line endings** are normalised by `.gitattributes`, so Windows and macOS users don't produce whole-file diffs.
6. The root `tsconfig.json` excludes `apps/`, so the gateway's typecheck and build never compile the frontend.

## Integration contracts (the only places our code meets)
- **Frontend → FHIR gateway:** HTTP only, per `docs/fhir-contract.md`. The frontend reads charts with
  `CLINICAL_SOURCE=fhir`, `FHIR_BASE_URL=http://localhost:4000/api/fhir/R4`, `FHIR_CLINIC_ID=demo-mock`
  (sent as `X-Clinic-Id`) and `FHIR_API_KEY` = the gateway's `INTERNAL_SERVICE_TOKEN` (sent as
  `Authorization: Bearer`). `X-Clinic-Id` alone gets 401. See `apps/web/src/lib/clinical/fhir-source.ts`
  and the README's Authentication section. A signed-in physician's Supabase access token also works in
  place of the service token.
  The chart also asks for `Condition`, `AllergyIntolerance`, `MedicationStatement` and `Observation`.
  Those sections stay empty until the gateway supports them.
- **Frontend → Supabase:** physician Auth (email/password). Later, a `visits` table backing
  `VisitStore` (`apps/web/src/lib/visits/store.ts`). The data owner writes the migration and the frontend owner writes the adapter.
- **Matching patients:** bookings carry name, date of birth and (optionally) an Ontario health card number.
  The frontend searches `Patient?identifier=<ohip>`, then `Patient?family=<surname>&birthdate=<yyyy-mm-dd>`.
