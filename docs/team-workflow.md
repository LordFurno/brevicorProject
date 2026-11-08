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

## Integration contracts

- **Frontend → FHIR gateway:** HTTP only, per `docs/fhir-contract.md`. Signed-in
  physicians forward their access token and selected membership clinic; sync and
  patient flows use `INTERNAL_SERVICE_TOKEN` with explicit clinic context. Never
  query clinical FHIR/mock/vendor tables directly from the frontend.
- **Frontend → Supabase:** physician Auth and clinic membership, plus server-only
  `visits`, `visit_events`, and `visit_photos`. Migrations remain at the root.
  No anonymous/authenticated memory-table or RPC grants. The secret key never
  enters browser code. State transitions and activity events commit atomically.
- **Frontend → notifications:** server-side calls to the root's `/api/notify/v1`.
  No contact fallbacks or provider SDKs in frontend notification code.
- **Patient matching:** stable `patient_ref` plus clinic, never name+DOB hashes or
  demographic search. Clinical display data is hydrated from FHIR per request.
- **Development booking:** disabled by default and confined to its memory preview.
  It is not an EHR appointment and never writes to the persistent activity store.

Detailed setup, sync and live verification: `apps/web/README.md`.
