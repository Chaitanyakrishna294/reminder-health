# reminder-health

Medication-reminder system for Indian patients + caregivers. Three surfaces, one Supabase Postgres:
Telegram bot + schedulers (`index.js`, `src/`, Render, service_role), Next.js 16 web PWA
(`web/`, Vercel, anon key + RLS), and SQL state machines (`db/migrations/`, applied manually).

**Before searching the repo, read [docs/WORK_LEDGER.md](docs/WORK_LEDGER.md)** — the canonical map:
file/route/table/RPC inventory, "how to add X" recipes, env vars, known landmines, and which docs
are stale. Keep it updated when you add or move anything.

## Hard rules
- **Migrations are applied manually** by the maintainer in the Supabase SQL editor. Never attempt to apply one; just write `db/migrations/migration_<slug>.sql` (+ rollback/validation when warranted).
- **moment-timezone stays** — `src/utils.js` and `web/src/lib/medication-utils.ts` must keep identical DST math. No Intl migration.
- **Dashboard nav = exactly 5 icons** (`dashboard-main-layout.tsx`); secondary pages go in the profile dropdown.
- **Medication catalog links are human-select-only** — never auto-match a nickname to a real drug (patient safety).
- Web deploys from **repo root**: `npx vercel deploy --prod --yes --scope chaitanya-krishnas-projects-397d3a53`. **The `--scope` is required** — without it the CLI returns `Not authorized` even though `vercel whoami` succeeds, because `.vercel/repo.json` pins an `orgId` that no longer resolves for the logged-in user. Root `.vercel/repo.json` maps the repo to project `reminder-health` with `directory: web`, so deploy from the ROOT, never from `web/`. Vercel ships the **working tree, not the commit** — check `git status` first, or uncommitted work goes to production too.
- For nontrivial Next.js work, heed `web/AGENTS.md`: this Next 16 differs from training data; check `node_modules/next/dist/docs/`.
- Exclude `.claude/worktrees/` from repo-wide greps (stale full checkout).

## Commands
- Worker tests: `npm test` (node:test). Web: no test script; `web/src/lib/schedule/*.test.ts` run via `node --experimental-strip-types`.
- Web dev server: `.claude/launch.json` → `web` (port 3001).
