# WORK LEDGER — canonical codebase map

> **Purpose:** answer "where does X live / how do I add Y" without searching the repo.
> Built 2026-07-25 from a full-repo audit. **Maintenance rule:** any change that adds/moves a file,
> route, table, RPC, or env var must update the matching section here (usually one line).
> This file supersedes the stale state docs — see §9 before trusting anything else in `docs/`.

---

## 1. System topology

Three surfaces share one Supabase Postgres (project `jaflclnakwtikqbfhfdk`):

```
Telegram bot + schedulers (Render free tier, service_role key, RLS bypassed)
  index.js → src/*            node-cron ticks, long-polling bot
Web app (Vercel, Next.js 16 App Router, anon key + RLS; service key for webhooks)
  web/src/*                   PWA + web push
Postgres (Supabase)           state machines live in SQL: RPCs + triggers + pg_cron
```

Failover: the bot upserts `scheduler_heartbeat` every minute-tick; `web/src/app/api/cron/tick`
(Vercel cron, `CRON_SECRET` bearer) is a no-op while the heartbeat is fresh (<180s), else acquires
the same `minute_tick` lease and sends **push + Telegram** (Telegram via `lib/telegram.ts`, needs
`TELEGRAM_BOT_TOKEN` on Vercel — set 07-26; degrades to push-only without it).

Deploy: web → `npx vercel deploy --prod --yes` **from repo root** (project `reminder-health`;
`web/.vercel` points at the wrong project). Worker → Render auto-deploy from git.
Migrations → pasted **manually into the Supabase SQL editor** by the maintainer; agents must
never attempt to apply one.

Both `src/utils.js` (bot) and `web/src/lib/medication-utils.ts` implement
`calculateNextReminder` with **moment-timezone** — they must stay in lockstep; do not migrate
either to Intl (DST math must match or reminders fire at wrong times).

---

## 2. Repo map

| Path | What |
|---|---|
| `index.js` | Worker entry: Express health probe + boots bot/schedulers |
| `src/` | Bot + schedulers (worker) |
| `web/` | Next.js app (own package.json; Tailwind v4, config-free) |
| `db/migrations|rollbacks|validations` | Hand-applied SQL — **`db/migrations/APPLIED.md` is the order ledger + current-function map**; `00_baseline_pre_repo_tables.sql` bootstraps fresh envs |
| `db/scripts/import-medication-catalog.js` | One-off CSV→`medication_catalog` loader (delete-then-insert) |
| `dataset/A_Z_medicines_dataset_of_India.csv` | 254k-row catalog source — **local-only, gitignored** since 07-27 (already imported into `medication_catalog`) |
| `test/` | Worker tests: `npm test` → `node --test "test/**/*.test.js"` |
| `scratch/` | ~60 unversioned ad-hoc probe/repair scripts; not runtime, not tests |
| `docs/` | See §9 — most are stale; this ledger + KNOWN_ISSUES + ARCHITECTURE_DECISIONS + PROJECT.md are the live ones |
| `.agents/skills/` | Vendored supabase skills (pinned by `skills-lock.json`) |
| `.claude/launch.json` | `web` dev server: `npm --prefix web run dev --port 3001` |

---

## 3. Worker (`src/`)

| File | Purpose | Key entry points |
|---|---|---|
| `src/bot.js` | Telegram singleton (long-poll); no-ops for synthetic `WEB-*` ids; mock bot if no token | `bot` |
| `src/db.js` | Supabase client (service_role → RLS bypassed; ownership enforced in JS) | `supabase` |
| `src/constants.js` | `FREQUENCIES`, FSM `STATES`, `CALLBACK_ACTIONS`, `MAIN_MENU`, `SNOOZE_MINUTES=10`, `MAX_SNOOZES=3` | — |
| `src/utils.js` | Time math: `calculateNextReminder` (L30), `isValidTime`, `escapeHTML` (snooze counts live in `reminder_events.snooze_count`, DB-authoritative) | — |
| `src/reminders.js` | Pure builders + stock math (`buildDoseKeyboard`, `buildTakePromptMessage`, `dosesPerDay`, `daysOfStockLeft`) — characterization-tested | — |
| `src/plan.js` | `getActivePlan`/`isCarePlus` from `subscriptions` (mirrors `web/src/lib/plan.ts`) | — |
| `src/scheduler.js` (889 loc) | Medication engine: 5 crons + `sendBrowserPush` (L32) | `initScheduler` (L149) |
| `src/commands.js` (1716 loc) | All Telegram UX: menu dispatch (L690), FSM (`userStates`), callback router (L1005), dose-response handler (L1454); every callback mutation is ownership-checked (`telegram_id` filter, or ACCEPTED active caregiver link for CG actions — callback_data is forgeable) | `initCommands` (L632) |
| `src/voice-scheduler.js` | Isolated Care+ voice tick; **no cron registered unless `VOICE_CALLS_ENABLED=true`** | `initVoiceScheduler` |
| `src/voice/exotel.js` | Raw-fetch Exotel outbound adapter | `placeCall`, `isConfigured` |

**Cron jobs (scheduler.js, all Asia/Kolkata):** `* * * * *` minute tick · Sun 20:00 weekly summary ·
09:00 low-stock alert · 07:00 morning patient summary · 21:30 caregiver summary. Voice tick is a
separate cron + separate lock (`voice_minute_tick`).

**Minute tick order:** acquire `minute_tick` lease (120s TTL, released in `finally`) → heartbeat
upsert → due-dose scan (`next_reminder_at <= now`, 60s resend guard; rows with no usable
`reminder_times` are pulled from the scan — `next_reminder_at` cleared, logged loudly) →
per-med send (OCC on
`last_sent_at`; `reminder_events` unique insert = idempotency; Telegram + `sendBrowserPush`;
advance `next_reminder_at`; 200ms delay between sends) → `scan_and_escalate_overdue_reminders`
RPC → react to transitions (GENTLE_REMINDER re-send / ESCALATED → caregiver alerts / PENDING_REVIEW
silent) → snoozed re-fire (CAS on status) → `close_daily_medications` RPC.
**State machine lives in SQL**; JS only messages.

**Recipes**
- *New bot command:* label in `constants.js` `MAIN_MENU` (+`CALLBACK_ACTIONS` if inline) → keyboard row in `commands.js` `mainMenuKeyboard` (~L96) → `handleX` in the Action Handlers block (try/catch, `escapeHTML` all DB strings, HTML parse mode) → dispatch line at L690-697. Slash-only commands: `bot.onText` inside `initCommands`. Multi-step: add to `STATES`, branch in the `on('message')` FSM, always `delete userStates[chatId]` when done. Callback data format `ACTION:arg1:arg2`; specific handlers must `return` before the L1454 catch-all; always `answerCallbackQuery`.
- *New scheduled job:* another `cron.schedule` in `initScheduler`; batch with `.in('telegram_id', ids)` (no N+1), `delay(200)` between sends.
- *New reminder-lifecycle state:* migration altering `scan_and_escalate_overdue_reminders` (+rollback +validation) → new branch in scheduler transition loop (L368-462) → add status to live-status array `commands.js:1505` → extend `verifySchedulerDependencies` if a new RPC.
- *New notification channel:* mirror `sendBrowserPush` — standalone fn that swallows its own errors, called after `bot.sendMessage` at the 4 send sites (L319/390/446/507).
- *Anything paid/risky:* copy `voice-scheduler.js` — separate file/cron/lock, `if (!ENABLED) return` before registering, so default-off costs nothing.
- *New message copy:* pure fn in `src/reminders.js` + characterization test in `test/reminders.test.js`.

---

## 4. Web app (`web/src/`)

Stack: Next.js 16.2.7 (read `web/AGENTS.md` warning — check `node_modules/next/dist/docs/` before
nontrivial framework work), React 19, TS strict, Tailwind v4 (no config; tokens are CSS vars in
`app/globals.css` `@theme inline`), lucide-react, zod. No test script; `lib/schedule/*.test.ts` are
bare node:assert scripts.

### Page routes

| Route | Notes |
|---|---|
| `/` → redirect `/dashboard` | |
| `/login` `/register` `/forgot-password` `/update-password` | `(auth)` group; Turnstile optional |
| `/link-account` | Redeem Telegram code or skip (synthetic `WEB-<uid>` id); outside route groups |
| `/install` `/privacy` `/terms` | Standalone/static |
| `/dashboard` | Server aggregates meds+events+logs → `DashboardClientView` (88 KB) |
| `/medications` · `/medications/new` (6-step wizard) · `/medications/[id]` (edit) | |
| `/schedule-planner` | Day-timeline planner (client, 42 KB) |
| `/health-vault` | Vault; `?patientId=` caregiver view gated `can_view_vault` |
| `/medical-profile` · `/emergency` | Medical card / red emergency card |
| `/settings` | Connect code, caregiver linking (dual-source new+legacy), account delete |
| `/care-circle` + `/[patientId]` + `/manage` + `/requests` | Caregiver console, permission manager, requests |
| `/care-plus` + `/care-plus/voice` | Care+ hub (currently unreachable from UI — entry points hidden) |
| `/admin-diagnostics` | Push/adherence diagnostics — `getAdminUser()` `ADMIN_EMAILS` allowlist, 404 for non-admins (hardened 07-26) |

### API routes (`app/api/`)

| Route | Client | Purpose |
|---|---|---|
| `auth/callback` | anon | Code exchange; creates fallback profile; open-redirect-safe `next` |
| `account/delete` | anon→service | `delete_my_account` RPC + `auth.admin.deleteUser` |
| `link-account/redeem` | anon | zod → `redeem_link_code` RPC |
| `push/subscribe` | anon (RLS) | Upsert `push_subscriptions` |
| `push/displayed` `push/opened` `push/acknowledge` | service | SW callbacks authenticated by hashed `push_tracking_tokens` |
| `care/contact-request` | anon→service | Patient → caregiver `notifications` fan-out |
| `cron/tick` | service | Heartbeat-gated send failover (§1) — sends **Telegram + push** via `lib/telegram.ts` (needs `TELEGRAM_BOT_TOKEN` on Vercel; degrades to push-only without it) |
| `admin/diagnostics` | service | GET aggregates + DELETE purge for `/admin-diagnostics`; gated by `ADMIN_EMAILS` via `lib/admin.ts` |
| `billing/start-trial` `billing/subscribe` `billing/webhook` | anon→service / service | Razorpay (HMAC + timingSafeEqual); dormant without env |
| `voice/twiml` `voice/response` `voice/status` `voice/verify/send` `voice/verify/check` | service (± anon) | IVR + OTP; all 404 unless `VOICE_CALLS_ENABLED=true` |

**Standard route shape:** `checkRateLimit()` → `getUser()` 401 → `zod.safeParse` 400 → work →
`NextResponse.json`. Default to the **anon server client** (RLS applies); escalate to
`createServiceClient()` only for webhooks/SW-callbacks/cross-user writes. Dose-state mutations go
through RPCs, never raw table writes. `lib/rate-limit.ts` and `lib/medications/catalog.ts`
**fail open** by design.

### Key lib modules

| Module | Purpose |
|---|---|
| `lib/supabase/{client,server,service-role,middleware}.ts` | The four client factories + `updateSession` (auth policy) |
| `lib/supabase/cached-queries.ts` | `react.cache` wrappers; **`resolveUserData()`** = the house auth resolver (self-heals profile via `ensure_my_profile`, resolves PATIENT_MONITOR from `view-mode`/`monitored-patient-id` cookies) |
| `lib/supabase/care-circle-service.ts` | Connection queries, metrics, permission updates (IST-hardcoded windows) |
| `lib/reminder-events.ts` | `resolveReminderEvent`/`correctReminderEvent` RPC wrappers — the single dose ledger |
| `lib/medication-utils.ts` | Web mirror of bot time math (lockstep rule, §1) |
| `lib/schedule/dose-engine.ts` · `bot-liveness.ts` | Pure helpers, have tests |
| `lib/schedule/dose-attention.ts` | Pending-vs-attention (missed) status partition + gate-queue order; shared by gate, missed strip, hero; has test |
| `lib/push/register-push.ts` (client) · `send-push.ts` (server) | Web-push both directions |
| `lib/plan.ts` · `billing/use-plan-status.ts` · `billing/luxe.ts` | Plan gate, client mirror, Care+ inline-style tokens (deliberately outside Tailwind) |
| `lib/rate-limit.ts` · `razorpay.ts` · `sms.ts` · `severity-theme.ts` · `medications/{catalog,form-logic}.ts` | As named |
| `lib/telegram.ts` | Failover Telegram sender (raw Bot API fetch; bot-compatible callback_data; no-op for `WEB-*` ids / missing token) |
| `lib/admin.ts` | `getAdminUser()` — `ADMIN_EMAILS` allowlist, fail closed |

Context: `theme-context` (light/dark, time-of-day default), `ui-mode-context`
(`normal|elderly` + `PATIENT_SELF|PATIENT_MONITOR`, persisted to `view-mode` cookie).
Hook: `use-realtime-notifications` (realtime `notifications` channel → bell).

Components live in `components/{layout,dashboard,medications,guide,billing,settings,medical,shared,ui}/`.
Big ones: `dashboard-client-view.tsx` (88 KB), `settings-client-view.tsx` (42 KB),
`medication-list.tsx` (26 KB). Also `missed-dose-strip.tsx` (top-pinned missed-dose alert, spec
2026-07-27; actionable in caregiver-monitor view; permanently-unresolvable doses render info-only)
and `med-due-gate.tsx` (full-screen "Did you take it?" gate: due-first queue, pinned asked dose,
one-by-one/all-at-once toggle; exports `permanentResolveError`/`UNSAVEABLE_DOSE_COPY`). Guided tours: `components/guide/*` (`TOURS` map in `guide-content.ts`,
`data-tour` attributes, `GuideAutoStart`).

**Recipes**
- *New dashboard page:* `app/(dashboard)/<route>/page.tsx` server component calling `resolveUserData()` with `export const revalidate = 0`. Nav: `getNavItems()` in `components/layout/dashboard-main-layout.tsx` — **exactly 5 icons, hard rule**; secondary pages go in the navbar profile dropdown. Optionally add to `shouldPrefetch()` allowlist and to `isProtectedRoute` in `lib/supabase/middleware.ts` (list synced 07-26 — keep it that way). Optional tour entry in `guide-content.ts`.
- *Auth flow:* middleware runs on every page/API route → refreshes session → unauthenticated on protected path → `/login`; no `telegram_chat_id` → `/link-account`. `(dashboard)/layout.tsx` + `resolveUserData()` is the real gate for dashboard pages.
- *Styling:* semantic tokens (`--primary` pink `#F26B8A`, `--foreground` navy, `--radius 1.75rem`); dark mode = `.dark` on `<html>` + compat `!important` layer in globals.css; elderly mode branches classNames via `useUiMode().isElderly`; Care+ surfaces use `lib/billing/luxe.ts` inline styles.
- *PWA:* `app/manifest.ts`; `public/sw.js` is hand-written, push+click only, **no fetch/caching**; registered app-wide by `components/register-sw.tsx` and again in `register-push.ts` (idempotent, intentional).

---

## 5. Database

27 tables + 1 view + 2 private buckets (`health-vault`, `avatars`). Full column detail:
agent-audited 2026-07-25; `docs/DATABASE_SCHEMA.md` is badly stale (§9).

**Core:** `profiles` (1:1 auth.users; `telegram_chat_id` unique, synthetic `WEB-<uuid>` for web-only;
`connect_code` RM+6) · `medications` (**no CREATE TABLE in repo** — pre-repo bot table, only ALTERed;
stock cols BOTH `tablet_count` and `current_stock`, see §8) · `reminder_events` (per-dose state
machine; UNIQUE(medication_id, scheduled_for); statuses SENT/DISPLAYED/OPENED/GENTLE_REMINDER/
ESCALATED/CAREGIVER_ACKNOWLEDGED/PENDING_REVIEW/UNCONFIRMED/TAKEN/SKIPPED/SNOOZED) ·
`reminder_logs` (adherence history; also no CREATE TABLE) · `notifications` (uuid PK, bell feed).

**Care circle:** `caregiver_connections` (modern many-to-many + 6 `can_*` permission flags,
`is_primary`) · `caregiver_info` (legacy CG###### registry — **still load-bearing** in RLS dual-reads
and `correct_reminder_event` auth) · view `active_caregiver_links` (union of both) ·
`caregiver_connection_audit_logs` · `patient_escalation_state`.

**Infra:** `link_codes` (hash-only since 07-11) · `push_subscriptions` · `push_logs` ·
`push_tracking_tokens` · `scheduler_locks` · `scheduler_heartbeat` · `rate_limits` · `audit_logs` ·
`chat_messages` (realtime).

**Vault/medical:** `health_categories` · `health_records` (soft delete `deleted_at`, 30-day trash) ·
`medical_profiles` (1:1, allergies/conditions/emergency contact, `share_photo_with_caregivers`).

**Voice/billing:** `voice_call_preferences` · `voice_calls` · `voice_call_usage` · `subscriptions`
(Razorpay; `plan` free/care_plus) · `medication_catalog` (254k rows, trigram GIN).

**Client-callable RPCs (all SECURITY DEFINER unless noted):** `invite_caregiver` ·
`respond_to_caregiver_request` · `lookup_profile_by_connect_code` · `lookup_caregiver_by_code` ·
`ensure_my_profile` · `resolve_reminder_event` · `correct_reminder_event` · `redeem_link_code` ·
`delete_my_account` · `search_medication_catalog` (INVOKER) · `check_rate_limit`.
**Scheduler RPCs (service role):** `try_acquire_scheduler_lock` / `release_scheduler_lock` ·
`scan_and_escalate_overdue_reminders` · `close_daily_medications`.
**pg_cron:** expire-stale-requests 01:00 · trash cleanup 00:00 · link-code cleanup :15 ·
rate-limit cleanup :30.

**RLS patterns (pick the matching one for new tables):**
1. Owner-by-`auth.uid()` (vault, medical, notifications, push_subscriptions…)
2. Owner-by-telegram-id subquery via profiles (medications, events, logs, voice, subscriptions)
3. Caregiver dual-read: `caregiver_connections` (ACCEPTED+active+`can_*` flag) OR legacy `caregiver_info`
4. RLS on, **zero policies** = service-role only (link_codes, phone_verifications, tokens, locks, heartbeat, rate_limits)
5. Read-only reference (`medication_catalog`: SELECT-true, no write policy)
6. Mutations via RPC only — events/logs have SELECT-only policies
Also: 2026-07 hardening revokes EXECUTE from `anon` on all SECURITY DEFINER fns.

**Migration workflow:** `db/migrations/migration_<slug>.sql` (+ `rollback_`, `validation_` when
warranted) → maintainer pastes into Supabase SQL editor → no runner, no version table; ordering is
git history. House convention is idempotent SQL (`IF NOT EXISTS` / `DROP POLICY IF EXISTS`).
Functions are redefined wholesale across files — the latest file wins; grep before editing one.
Bot uses service_role, so RLS tightening can only break the web app, never the bot.

---

## 6. Env vars

| Var | Where | Notes |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` `SUPABASE_URL` `SUPABASE_KEY`(service) | Render | Worker core |
| `VAPID_SUBJECT` `NEXT_PUBLIC_VAPID_PUBLIC_KEY` `VAPID_PRIVATE_KEY` | Render + Vercel | Push (worker warns+disables if missing) |
| `NEXT_PUBLIC_SUPABASE_URL` `NEXT_PUBLIC_SUPABASE_ANON_KEY` `SUPABASE_SERVICE_ROLE_KEY` | Vercel (+`web/.env.local`) | Web core |
| `CRON_SECRET` | Vercel | `/api/cron/tick` bearer; 503 if unset |
| `TELEGRAM_BOT_TOKEN` | Vercel too (set 2026-07-26) | Failover Telegram sends from `/api/cron/tick`; push-only without it |
| `ADMIN_EMAILS` | Vercel | Comma-separated allowlist for `/admin-diagnostics`; empty = nobody |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Vercel | Optional captcha |
| `VOICE_CALLS_ENABLED` `PUBLIC_WEBHOOK_BASE_URL` `EXOTEL_*` `VOICE_DAILY_CALL_CAP` `VOICE_MONTHLY_CALL_QUOTA` | **both** Render & Vercel identically | Voice stack (dormant) |
| `SMS_PROVIDER` `MSG91_*` `EXOTEL_SMS_SENDER` `RAZORPAY_*` | Vercel | SMS/billing (dormant) |

---

## 7. Feature flags & dormant surfaces

- `VOICE_CALLS_ENABLED` — off ⇒ voice cron never registered, all `/api/voice/*` 404. Care+ line is shelved (`archive/care-plus` branch; entry points hidden by `c3c44b3`); `/care-plus` reachable only by URL.
- `FEATURE_FLAG_ENABLE_PILL_SLIDER = false` in `dashboard-client-view.tsx` (medication-slider unused).
- `SHOW_REMINDER_WINDOWS = false` in `components/settings/call-schedule.tsx` (nightly-confirm only).
- Medication catalog: **human-select-only, never auto-match** (patient safety rule).
- Razorpay/SMS libs are inert without env.

---

## 8. Landmines & open items

*Fixed in the 2026-07-26 backbone-hardening pass* (details in that day's commits):
stock burn-rate math unified in `daysOfStockLeft` (bot cron/panels + web dashboard;
bot add-med now sets `low_stock_alert_enabled`); caregiver timeline sort; dead retry
code deleted (SQL owns retry timing); `activeSnoozes` deleted (DB-authoritative);
failover sends Telegram; `/admin-diagnostics` gated (`ADMIN_EMAILS` + service route);
middleware route list synced; `getUnitIcon` single-sourced in `ui/custom-icons.tsx`;
dead component + boilerplate assets deleted; `logo2.png` 1.5 MB → 14 KB;
non-idempotent migrations guarded; superseded vault migrations marked.

*Still open*
- **Voice/Exotel is SHELVED** (2026-07-26): the maintainer is not pursuing Exotel
  (personal cost). Don't resume voice work; the stack stays dormant at zero cost.
  The "rotate key" warning in `docs/EXOTEL_SUPPORT_BRIEF.md` is moot.
- `ADMIN_EMAILS` on Vercel is intentionally unset (nobody can open
  /admin-diagnostics) — the context email krishnac0294@gmail.com is a TEST mail,
  never auto-enroll it; the maintainer adds their real email when needed.
- Next 16 deprecation warning at build: the `middleware` file convention → rename
  `web/src/middleware.ts` to `proxy.ts` per the Next migration guide before a
  future Next upgrade removes support (cosmetic today; builds fine).
- `check_rate_limit` anon grant was revoked by the 07-09 hardening loop — any future
  unauthenticated rate-limit path is silently broken (web uses service client; fine today).
- `resolve_reminder_event` permanently rejects some doses (planner-shifted virtual doses →
  `INVALID_SCHEDULED_TIME`, deactivated meds → `MEDICATION_NOT_FOUND`, plus
  `EVENT_MEDICATION_MISMATCH` / `VIRTUAL_EVENT_MUST_BE_FOR_TODAY` / `NOT_AUTHORIZED`).
  The web now marks these session-locally unresolvable (gate skips them, strip rows go
  info-only with honest copy); they are only recorded by `close_daily_medications` at
  day's end. The RPC-side limitation itself is unaddressed.
- `userStates` (bot conversation FSM) is still in-memory; a worker restart drops
  in-flight add-medication flows (acceptable; user restarts the wizard).
- Worker still pauses at month-end on Render free tier; failover now covers push +
  Telegram sends, but bot button-taps go unanswered until the worker resumes.
- `00_baseline_pre_repo_tables.sql` defaults are best-effort reconstructions —
  verify against live schema before trusting for a prod-parity environment.
- 2 unreferenced mascot PNGs (`point-left`, `point-right`) kept (may be used by future tours).
- `.claude/worktrees/exciting-chaplygin-cb98c4/` is a full old checkout — **exclude it from repo-wide greps**.

---

## 9. Docs index — what to trust

| Trust | Docs |
|---|---|
| **Live / authoritative** | This ledger · root `README.md` (rewritten 2026-08-06, three-surface era) · `KNOWN_ISSUES.md` (07-11, freshest state) · `ARCHITECTURE_DECISIONS.md` (ADR-001..006; stops before heartbeat/catalog) · `PROJECT.md` (terse reference, mostly current) · `PROJECT_WALKTHROUGH.md` + `FAQ.md` (07-20, narrated tour + glossary; tracked in git since 07-26) · `web/AGENTS.md` |
| **Reference, partial** | `PERMISSION_MATRIX.md` (two claims wrong re `are_profiles_connected`) · `DEPLOYMENT_GUIDE.md` (no CRON_SECRET/voice vars) · `DESIGN_BRIEF.md` · `LEGAL_COMPLIANCE.md` |
| **Stale — do not trust for state** | `AI_SESSION_START.md` (now redirects here) · `CURRENT_SYSTEM_STATE.md` · `SPRINT_STATUS.md` · `FEATURE_INVENTORY.md` · `PROJECT_JOURNAL.md` · `ENGINEERING_STATE.md` (lists shipped work as "Not Started") · `DATABASE_SCHEMA.md` (20 of 27 tables missing, wrong status enum) · `UI_UX_DESIGNER_HANDOVER.md` (says Next 15) |
| **Voice line (shelved)** | `VOICE_CALLS_DESIGN.md` · `VOICE_LAUNCH_CHECKLIST.md` · `EXOTEL_SUPPORT_BRIEF.md` — mutually contradictory on build status; checklist is the accurate runbook |
| **Plans/specs** | `docs/superpowers/plans/*` — checkbox state is meaningless (all unchecked); every plan through 07-27 is SHIPPED per git (incl. missed-dose visibility, amended post-review: hero prefers a due-now dose) |

Do-not-modify without ADR review (carried over): permission model, care-circle architecture,
notification architecture.
