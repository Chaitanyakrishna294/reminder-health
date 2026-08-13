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

Deploy: web → `npx vercel deploy --prod --yes --scope chaitanya-krishnas-projects-397d3a53`
**from repo root** (project `reminder-health`, linked via root `.vercel/repo.json` with
`directory: web`; never deploy from `web/`). **`--scope` is required** — without it the CLI fails
with `Not authorized` even though `vercel whoami` succeeds, because the `orgId` pinned in
`repo.json` no longer resolves for the logged-in user (hit 08-10; re-linking would also fix it).
Vercel deploys the **working tree, not the commit** — `git status` before shipping, or
uncommitted work goes to prod. Worker → Render auto-deploy from git.
Migrations → pasted **manually into the Supabase SQL editor** by the maintainer; agents must
never attempt to apply one.

Both `src/utils.js` (bot) and `web/src/lib/medication-utils.ts` implement
`calculateNextReminder` with **moment-timezone** — they must stay in lockstep; do not migrate
either to Intl (DST math must match or reminders fire at wrong times). Both take a third
`doseDays` arg (weekdays the med is due, 0=Sun..6=Sat; null/empty = daily) and walk forward
day-by-day to the next due weekday — that is the ONLY place the weekly cadence is enforced for
sending, since the due-scan filters purely on `next_reminder_at`. The projection side of the
same rule is `occursOn`/`occursOnWeekday` in `web/src/lib/schedule/dose-engine.ts`; all three
must agree or the UI draws a dose no scheduler sends.

**Guest (anonymous) accounts.** `signInAnonymously()` from `/welcome` creates a REAL auth user
(`is_anonymous = true`), so the untouched `handle_new_user()` trigger gives it the usual profile
with a synthetic `WEB-<uuid>` id and the proxy routes it straight to `/dashboard`. Converting a
guest (`/save-account`: `updateUser({email})` → `verifyOtp({type:'email_change'})`) keeps THE
SAME `auth.uid()`, so **no data is copied or re-keyed at any point** — that is the whole design.
Guests are blocked from `caregiver_connections` and `health_records` by BEFORE INSERT triggers
(`public.guard_guest_write()`), and from Telegram linking in `/api/link-account/redeem`; the
`GUEST_ACCOUNT_REQUIRED` sentinel is matched client-side by `isGuestGuardError` in
`web/src/lib/auth/guest.ts`. Everything else (medications, doses, planner) is open — that is the
product being tried. **Requires the Supabase dashboard toggle** (Authentication → Sign In /
Providers → Anonymous sign-ins) plus CAPTCHA; with it off, the welcome screen simply says guest
mode is unavailable.

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
| `/login` `/register` `/forgot-password` `/update-password` | `(auth)` group; Turnstile optional. Redesigned 2026-08-09 from generated mockups: layout = small brand row + fields directly on `--auth-radial` + peek-mascot trust strip (no frosted card, each page owns its `<h1>`); login swaps between password and code screens, and register/forgot/update follow the same system (no hex-gradient buttons — `buttonClasses()` only); `components/auth/code-entry.tsx` owns the shared `CodeInput` (inline letter-spacing: unlayered `.font-mono` in globals beats Tailwind utilities) + `SpamCallout`; assets `mascot/login-hero.png` + `login-peek.png` (sharp-compressed from 1.4MB originals) |
| `/welcome` | Signed-out front door (2026-08-09, mockup "Never miss a dose"): hero mascot + pink sweep, email field hands off to `/login?email=…` (login prefills it). `/` routes signed-out here (app/page.tsx); proxy bounces signed-in users to `/dashboard`. Theme-FIXED illustration colours on purpose (see file comment) |
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
| `lib/auth/guest.ts` | `isGuest`/`isGuestGuardError`/`GUEST_LOCKED` — guest-session predicate + the copy for each locked surface (§1) |
| `lib/schedule/dose-engine.ts` · `bot-liveness.ts` | Pure helpers, have tests |
| `lib/schedule/dose-attention.ts` | Pending-vs-attention (missed) status partition + gate-queue order; shared by gate, missed strip, hero; has test |
| `lib/push/register-push.ts` (client) · `send-push.ts` (server) | Web-push both directions |
| `lib/plan.ts` · `billing/use-plan-status.ts` · `billing/luxe.ts` | Plan gate, client mirror, Care+ inline-style tokens (deliberately outside Tailwind) |
| `lib/design/semantics.ts` | **Colour→meaning + canonical labels.** `PRIORITY` (Routine/Important/Critical), `CARE_LABELS` (patient-side first), `DOSE_TONE`/`doseLabel`, `TONE_VAR`. Import these instead of typing a status word or a hex — see `docs/DESIGN_SYSTEM.md` |
| `lib/health-vault/limits.ts` · `compress-image.ts` | **The 5-file / 5 MB / images-and-PDF vault quota, client side** (2026-08-13). Numbers + all the refusal copy in one module, in lockstep with `migration_vault_upload_limits_2026_08_13.sql`; `compressImage()` resizes photos to 2000px JPEG before upload so the ceiling does not fight an ordinary camera. **Politeness layer only** — the browser uploads straight to Storage, so the real refusal is the bucket ceiling + the `storage.objects` policy. Has a test (`limits.test.ts`) |
| `lib/design/density.ts` | **The three densities as one system** (2026-08-13): `Density` = `browser \| app \| elderly`, `resolveDensity()`, and `DENSITY_LAYOUT` — the table saying what each one renders. Presentation only; never gate a derivation or a write path on it. `?preview=app\|browser` forces one for the session |
| `lib/severity-theme.ts` | tone→Tailwind classes (`getToneTheme`, `getSeverityTheme`). `.text` is the readable-on-tint colour; never `text-*-foreground` on a tint |
| `lib/medications/stock.ts` | **Web mirror of the bot's low-stock predicate** (`isLowStock`: threshold first, `daysOfStockLeft <= 3` backup). Lockstep with `src/reminders.js` is enforced by `test/fixtures/low-stock-cases.json`, which both tests read — same mirror discipline as the moment-timezone pair |
| `lib/medications/add-stock.ts` | The single web path that writes `current_stock`. Raising it clears `low_stock_notified_at` via the `rearm_low_stock_notice()` trigger |
| `lib/rate-limit.ts` · `razorpay.ts` · `sms.ts` · `severity-theme.ts` · `medications/{catalog,form-logic}.ts` | As named |
| `lib/telegram.ts` | Failover Telegram sender (raw Bot API fetch; bot-compatible callback_data; no-op for `WEB-*` ids / missing token) |
| `lib/admin.ts` | `getAdminUser()` — `ADMIN_EMAILS` allowlist, fail closed |

Context: `theme-context` (light/dark, **defaults to light** when nothing is saved), `ui-mode-context`
(`normal|elderly` + `PATIENT_SELF|PATIENT_MONITOR`, persisted to `view-mode` cookie; also owns the
elderly view lock on `profiles.ui_mode_locked`), `density-context` (`useDensity()` → the browser/app/
elderly split; mounted INSIDE `UiModeProvider` because elderly outranks the rest, and paired with a
pre-paint `data-density` script in `app/layout.tsx` + the `.browser-only` rule in globals.css).
Hook: `use-realtime-notifications` (realtime `notifications` channel → bell).

Components live in `components/{layout,dashboard,medications,guide,billing,settings,medical,shared,care-circle,ui}/`.
`components/ui/` holds the shared primitives — `button.tsx` (`Button`/`buttonClasses()`/`IconButton`,
all sizes ≥44px), `badge.tsx` (`Badge`/`CountBadge`), `empty-state.tsx`, `eyebrow.tsx`, plus
`custom-icons.tsx` and `premium-toast.tsx`. `components/care-circle/connection-actions.tsx` owns
accept/disconnect/monitor for care relationships (incl. the legacy `caregiver_info` branches) —
**`/care-circle` is canonical for these; `/settings` keeps identity codes only and links out.**
Big ones: `dashboard-client-view.tsx` (82 KB), `medication-list.tsx` (53 KB).
`settings-client-view.tsx` is **gone** (2026-08-13) — Settings is now a grouped-row hub
(`app/(dashboard)/settings/settings-hub.tsx` + `components/settings/settings-row.tsx`) pushing one
sub-page per concern (`account`, `connections`, `notifications`, `display`, `language`, `help`,
`legal`, `setup-guide`). Stale references to the old file remain in comments only. Also `missed-dose-strip.tsx` (top-pinned missed-dose alert, spec
2026-07-27; actionable in caregiver-monitor view; permanently-unresolvable doses render info-only)
and `med-due-gate.tsx` (full-screen "Did you take it?" gate: due-first queue, pinned asked dose,
one-by-one/all-at-once toggle; exports `permanentResolveError`/`UNSAVEABLE_DOSE_COPY`).
`dashboard/refill-strip.tsx` (dashboard-pinned low-stock summary, warning tone) and
`dashboard/refill-gate.tsx` (full-screen refill prompt, same one-stock-write path as the strip) round
out the refill-reminder feature. `dashboard/dose-strip.tsx` (added 2026-08-09) is today's doses as a
row of blister pockets — it replaced the four Morning/Afternoon/Evening/Night tiles, and tapping a
pocket drives the compliance ring's centre (which was hover-only, i.e. dead on a phone). It takes
`now` as a prop rather than reading `Date.now()` in render (`react-hooks/purity`). Guided tours: `components/guide/*` (`TOURS` map in `guide-content.ts`,
`data-tour` attributes, `GuideAutoStart`). A step may carry `densities?: Density[]` when its target
only exists at some densities — `guide-tour.tsx` filters on it so step counts stay honest; note
`medications/new/page.tsx` indexes `TOURS.newMedication` by raw index, so that one tour must stay
unfiltered unless both sides change together. `components/dev/density-preview-badge.tsx` renders only
while `?preview=` is forcing a density.

**Recipes**
- *New dashboard page:* `app/(dashboard)/<route>/page.tsx` server component calling `resolveUserData()` with `export const revalidate = 0`. Nav: `getNavItems()` in `components/layout/dashboard-main-layout.tsx` — **exactly 5 icons, hard rule**; secondary pages go in the navbar profile dropdown. Optionally add to `shouldPrefetch()` allowlist and to `isProtectedRoute` in `lib/supabase/middleware.ts` (list synced 07-26 — keep it that way). Optional tour entry in `guide-content.ts`.
- *Auth flow:* the proxy (`web/src/proxy.ts` — Next 16's renamed `middleware` convention) runs on every page/API route → refreshes session → unauthenticated on protected path → `/login`; no `telegram_chat_id` → `/link-account`. `(dashboard)/layout.tsx` + `resolveUserData()` is the real gate for dashboard pages.
- *Styling:* semantic tokens (`--primary` pink `#F26B8A`, `--foreground` navy, `--radius 1.75rem`). **Read `docs/DESIGN_SYSTEM.md` before picking a colour** — solid buttons use `--primary-strong`/`--danger-strong` (the base tokens are too light to carry white text: 2.9:1 and 3.55:1), text on a status tint uses the `-strong` variants (`-foreground` is white and vanishes there), and `.floating-bottom` is how root-layout overlays clear the mobile dock; dark mode = `.dark` on `<html>` + compat `!important` layer in globals.css; elderly mode branches classNames via `useUiMode().isElderly`; Care+ surfaces use `lib/billing/luxe.ts` inline styles.
  - *Entrance motion:* `.rise-in` in globals.css is the app's one section-entrance (14px rise + fade, 420ms strong ease-out). Stagger with `style={{ '--rise-delay': '60ms' }}`, 60ms apart, whole cascade under ~400ms. Don't hand-roll per-page fade keyframes. `prefers-reduced-motion` is already handled by the global rule at the foot of globals.css.
  - Tailwind's `dark:` variant is bound to that same `.dark` class by `@custom-variant dark (&:where(.dark, .dark *));` in globals.css. **Keep that line** — Tailwind v4 otherwise defaults `dark:` to the OS `prefers-color-scheme`, which the in-app toggle can contradict. Note `<html>` is `.dark`-classed by the anti-FOUC script in `app/layout.tsx` ONLY when a saved `'dark'` choice exists; otherwise it paints light. This is in lockstep with `theme-context.tsx`, which also defaults to light — keep the two matching to avoid a first-paint flash.
- *PWA:* `app/manifest.ts` (start_url `/launch.html`); `public/sw.js` is hand-written: push+click plus ONE narrow fetch handler that serves only the precached `/launch.html` + mascot (bump `LAUNCH_CACHE` when launch.html changes; precache uses `cache: 'reload'` so a bump can never re-store a stale copy); registered app-wide by `components/register-sw.tsx` and again in `register-push.ts` (idempotent, intentional).
- *Installed-app launch flow (2026-08-09):* `/launch.html` splash → cold opens forward to `/dashboard?launch=1`, where `components/launch-handoff.tsx` holds an identical overlay until hydration (lifts at effect-run/DOMContentLoaded, 2.5s stall cap, plus an **8s CSS-only failsafe** for dead-JS cases); opens within an hour of the last **completed** launch skip the overlay and stream progressively (`remind-last-launch` in localStorage — stamped by the handoff **teardown**, never by launch.html, so stalled attempts can't mark the next open warm); launch.html re-arms a 12s stall watchdog per attempt (retry UI), and sw.js's activate re-navigates any window still parked on `/launch.html` so a broken cached splash heals on the first open after a deploy. **`/launch.html` is excluded from the proxy matcher** — its inline script cannot carry the per-request CSP nonce and `'strict-dynamic'` ignores `'self'`, so the CSP added by the 2026-08-08 security pass blocked it and froze installed apps on the splash forever. Any new `public/*.html` with inline script has the same landmine. Android TWA (`android-twa/`, unversioned) opens `/dashboard` directly — no splash.

---

## 5. Database

27 tables + 1 view + 2 private buckets (`health-vault`, `avatars`). Full column detail:
agent-audited 2026-07-25; `docs/DATABASE_SCHEMA.md` is badly stale (§9).

**Storage quotas (2026-08-13, PENDING —`migration_vault_upload_limits_2026_08_13.sql`).** `health-vault`
carries `file_size_limit` 5 MB + `allowed_mime_types` images/PDF, and its INSERT policy calls
`vault_can_accept_upload()` for the 5-file-per-user cap and blocks guests. **This is the only layer
that counts**: the client uploads to Storage directly with the anon key, so the upload form's checks
are advice. The cap counts storage OBJECTS, so a trashed record holds its slot until
`cleanup_expired_trash` purges it at 30 days. See CLAUDE.md's hard rule; unbounded-growth audit in
`db/audits/audit_unbounded_growth_2026_08_13.sql` (open findings: `audit_logs` client INSERT, avatars
object count).

**Core:** `profiles` (1:1 auth.users; `telegram_chat_id` unique, synthetic `WEB-<uuid>` for web-only;
`connect_code` RM+6) · `medications` (**no CREATE TABLE in repo** — pre-repo bot table, only ALTERed;
stock cols BOTH `tablet_count` and `current_stock`, see §8; `dose_days SMALLINT[]` = which weekdays
the med is due, 0=Sun..6=Sat, **NULL means every day** — never backfill it to {0..6} — while
`reminder_times` stays how many doses fall within a due day and `frequency` is only a label +
stock math — migration_dose_days_2026_08_10.sql) · `low_stock_notified_at`
(refill-alert suppression; cleared by `rearm_low_stock_notice()` on any stock increase) ·
`reminder_events` (per-dose state
machine; UNIQUE(medication_id, scheduled_for); statuses SENT/DISPLAYED/OPENED/GENTLE_REMINDER/
ESCALATED/CAREGIVER_ACKNOWLEDGED/PENDING_REVIEW/UNCONFIRMED/TAKEN/SKIPPED/SNOOZED;
`last_prompted_at` = escalation-anchor override, stamped ONLY at snooze re-fire via a separate
best-effort write; initial-send anchor = `created_at` DB default, never named in the INSERT;
ladder clamps the anchor to `created_at`+30m — applied 2026-08-08, APPLIED.md #59) ·
`reminder_logs` (adherence history; also no CREATE TABLE) ·
`notifications` (uuid PK, bell feed).

**Care circle:** `caregiver_connections` (modern many-to-many + 6 `can_*` permission flags,
`is_primary`) · `caregiver_info` (legacy CG###### registry — **no longer read by any RLS policy**
as of 2026-08-11, APPLIED.md #67; still read by `correct_reminder_event` auth and the care-circle
UI. Live contents are now 1 real relationship + 2 inert rows with NULL `patient_telegram_id`, so
retiring it entirely is a realistic cleanup) · view `active_caregiver_links` (union of both) ·
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
3. Caregiver read: `caregiver_connections` (ACCEPTED+active+`can_*` flag) — **single path since
   2026-08-11.** The legacy `caregiver_info` OR-branch was removed: being `UNION`ed and ungated, it
   granted regardless of the `can_*` flags, making a patient's permission toggles a no-op. Do NOT
   reintroduce a dual-read in a new policy.
4. RLS on, **zero policies** = service-role only (link_codes, phone_verifications, tokens, locks, heartbeat, rate_limits)
5. Read-only reference (`medication_catalog`: SELECT-true, no write policy)
6. Mutations via RPC only — events/logs have SELECT-only policies
**Function EXECUTE grants — this line used to overstate what is enforced.** The 2026-07
hardening ran `REVOKE EXECUTE ... FROM anon` over every SECURITY DEFINER function, and that
only removes a DIRECT grant. It does **not** remove access held via `PUBLIC` — you cannot
revoke a PUBLIC-derived privilege from one role, and Postgres raises no error when you try,
so the sweep was a silent no-op wherever `proacl` was still NULL (NULL = default privileges
= EXECUTE to PUBLIC). Found 2026-08-13 when `correct_reminder_event` validated with
`anon = true` despite having been through both that sweep and a later
`REVOKE ... FROM PUBLIC`.
**Every new function needs BOTH revokes** — see `db/migrations/_TEMPLATE_new_rpc.sql`, which
exists so this is copy-paste rather than remembered. To see the current blast radius run
`db/audits/audit_function_execute_grants_2026_08_13.sql`; it lists every public function
`anon` can execute and which of the two routes it comes through.

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

**"Vercel" above means a specific environment, not all three.** Vercel scopes each var to
Production / Preview / Development independently, so a var can be live in prod and absent in
preview. `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` must be present in
**Preview** too: the auth pages (`/login`, `/forgot-password`, …) are statically prerendered at
build time and construct a Supabase client while doing so, so a missing key fails the *build*, not
just runtime — `@supabase/ssr: Your project's URL and API key are required to create a Supabase
client!` → `Export encountered an error on /(auth)/forgot-password/page`. Preview was missing the
anon key from 61d ago until 2026-08-06, so every PR showed a red ✗ while prod stayed green; added
via `vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY preview`. Check with `vercel env ls` (the
`environments` column) before assuming a var is everywhere.

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
- ✅ DONE 2026-08-08: renamed `web/src/middleware.ts` → `web/src/proxy.ts` (Next 16
  renamed the `middleware` file convention to `proxy`; the export is now `proxy`, same
  matcher config). `npm run build` confirms `ƒ Proxy (Middleware)` and no deprecation
  warning. The auth policy still lives in `lib/supabase/middleware.ts` (`updateSession`) —
  that is a plain module, not a file convention, so it keeps its name.
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
- Refill-gate snooze (`localStorage.refillGateSnoozedUntil`) is per-device, like the
  dose gate's `medGateSnoozes` — "remind me tomorrow" on a phone does not silence a tablet.

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
