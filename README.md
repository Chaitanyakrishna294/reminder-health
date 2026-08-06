# Re-MIND-eЯ

Re-MIND-eЯ is a medication-reminder system for Indian patients and their caregivers,
built for elderly and non-technical users. It started as a Telegram-only bot and has
grown into three surfaces sharing one Supabase Postgres database:

| Surface | Where | What |
|---|---|---|
| Telegram bot + schedulers | `index.js`, `src/` — Node worker on Render | Button-driven bot, reminder engine, escalation and summary jobs |
| Web app (PWA) | `web/` — Next.js 16 App Router on Vercel | Dashboard, caregiver console, health vault, web push, installable PWA |
| Database | `db/migrations/` — Supabase Postgres | Dose state machines as SQL RPCs + triggers + pg_cron; RLS for the web, service role for the worker |

## What it does

**For patients**

- Medication reminders over Telegram and browser push, driven by a minute-tick scheduler
- Simple button responses: Taken / Skip / Snooze (10 min, up to 3 times)
- A "Did you take it?" gate and a pinned missed-dose strip on the web dashboard, so
  missed doses cannot be overlooked — plus adherence stats and daily logs
- Tablet stock tracking with low-stock refill alerts
- Morning schedule summaries and weekly adherence reports over Telegram
- Health vault (documents), medical profile, and an emergency card
- Elderly mode (larger type and touch targets), light/dark theme, guided tours
- Optional linking of a medication nickname to a real Indian drug from a 254k-entry
  catalog — always chosen by a human, never auto-matched (patient safety rule)

**For caregivers**

- A care circle linking caregivers to patients with per-permission flags
- Escalation when a dose stays unanswered: gentle re-reminder, then caregiver alerts
- Monitoring view of a patient's dashboard, including resolving missed doses
- An evening summary of each patient's day, delivered over Telegram

**Reliability**

- The dose lifecycle (SENT → … → TAKEN/SKIPPED/UNCONFIRMED) lives in SQL RPCs, so
  bot, web, and cron all share one state machine and one dose ledger
- The worker heartbeats every minute; if it goes quiet, a Vercel cron takes over the
  reminder tick and sends push (and Telegram, when a bot token is configured on Vercel)

## Repository layout

```
index.js            Worker entry: Express health probe + boots bot/schedulers
src/                Telegram bot, reminder scheduler, summary crons
web/                Next.js app (own package.json)
db/migrations/      Hand-applied SQL (see below); rollbacks/ and validations/ alongside
db/scripts/         One-off medication-catalog CSV importer
test/               Worker tests (node:test)
docs/               Project docs — start with docs/WORK_LEDGER.md
```

**Docs:** [`docs/WORK_LEDGER.md`](docs/WORK_LEDGER.md) is the canonical codebase map —
files, routes, tables, RPCs, env vars, and "how to add X" recipes. Read it before
searching the repo; several older docs in `docs/` are stale and it says which.

## Running locally

Prereqs: Node.js, a Supabase project, and a Telegram bot token from @BotFather.

**Database** — migrations are not applied by any runner. Apply the SQL in
`db/migrations/` manually in the Supabase SQL editor, starting with
`00_baseline_pre_repo_tables.sql` for a fresh environment.

**Worker (bot + schedulers)**

```bash
npm install
cp .env.example .env   # fill in TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_KEY, …
npm start              # node index.js
npm test               # node --test "test/**/*.test.js"
```

**Web app**

```bash
cd web
npm install
# put NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY (and the VAPID keys for push) in web/.env.local
npm run dev -- --port 3001
```

`.env.example` documents every variable, including the dormant voice/SMS/billing
stack (all inert unless explicitly enabled).

Web schedule-lib tests are bare node scripts:
`node --experimental-strip-types web/src/lib/schedule/dose-engine.test.ts` (same for
`dose-attention.test.ts`).

## Tech

Node.js, node-telegram-bot-api, node-cron, Express, moment-timezone (deliberately —
the bot and web must share identical DST math), Next.js 16, React 19, TypeScript,
Tailwind v4, Supabase (Postgres, Auth, Storage, Realtime), web-push.

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0) - see the [LICENSE](LICENSE) file for details.

Copyright (C) 2026 chaitanya krishna

You are free to use, study, and modify this code. However, if you run a modified version of this software as a network service (bot, website, API), you **must** make your complete source code available to its users under the same license.
