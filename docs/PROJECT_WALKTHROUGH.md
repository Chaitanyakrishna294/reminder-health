# Re-MIND-eЯ — Project Walkthrough

**Purpose of this document:** a single place to (re-)learn the *whole* codebase well enough to explain
it confidently to a technical interviewer/reviewer — what each piece is, why it exists, and how data
flows through the system end to end. It complements `PROJECT.md` (terse reference) and the deep-dive
docs in `docs/` (ADRs, schema, known issues) — this file is the narrated version.

Companion doc: [`docs/FAQ.md`](FAQ.md) — plain-English explanations of every non-obvious technology
used, plus a Q&A / troubleshooting playbook.

---

## 1. The elevator pitch

> "Re-MIND-eЯ is a medication-adherence platform for patients (often elderly) and the family members
> who look after them. A patient logs their medications once; the system reminds them via Telegram
> and browser push at the right time, in their own timezone. If they don't respond, it escalates —
> first a gentle nudge, then an alert to their caregivers. Caregivers form a 'Care Circle' around a
> patient with granular, consent-based permissions (view meds, view vault, receive escalations), and
> get a live dashboard of adherence, stock levels, and missed doses. Everything — reminders, stock
> tracking, escalation, permissions — is enforced by the database itself (Postgres RLS + SECURITY
> DEFINER RPCs + triggers), not just application code, so the Telegram bot, the web app, and a
> failover cron job can all safely share one source of truth."

The one architectural idea to lead with: **the database is not just storage, it's where the business
rules live.** Three different runtimes (Telegram bot, Next.js web app, Vercel cron) write to the same
Postgres tables through the same RPCs, so behavior never drifts between surfaces.

---

## 2. High-level architecture

```
                     ┌─────────────────────────┐
                     │   Supabase (Postgres)    │
                     │  Auth · Storage · RLS ·  │
                     │  RPCs · Triggers ·       │
                     │  pg_cron · Realtime      │
                     └────────────┬─────────────┘
                                  │  (single source of truth)
        ┌─────────────────────────┼─────────────────────────┐
        │                         │                         │
┌───────▼────────┐      ┌─────────▼─────────┐     ┌─────────▼──────────┐
│  Telegram bot   │      │   Next.js web app  │     │  Vercel cron route  │
│  + scheduler    │      │   (App Router)     │     │  /api/cron/tick     │
│  (Render, Node) │      │   (Vercel)         │     │  (failover only)    │
│  service_role   │      │   RLS-scoped +     │     │  service_role       │
│  key — bypasses │      │   service_role     │     │  key                │
│  RLS            │      │   where needed     │     │                     │
└────────┬────────┘      └─────────┬──────────┘     └──────────┬──────────┘
         │                         │                            │
   Telegram API              Browser (React 19)            Runs only if the
   + Web Push (VAPID)        + Service Worker (PWA)         bot's heartbeat
                                                             looks stale
```

**Why three surfaces instead of one?** The Telegram bot was the original MVP (V1) — it's still the
richest interaction surface for elderly users. The web app (V2) added caregiver coordination, a
document vault, and a proper account model. The cron failover route (V3) is pure infrastructure
resilience: the bot runs on Render's free tier, which pauses when its monthly free instance-hours run
out; the failover route is a safety net that only activates automatically when the bot goes quiet, and
otherwise does nothing.

---

## 3. Tech stack, and why each piece was chosen

| Layer | Choice | Why |
|---|---|---|
| Web framework | **Next.js 16 (App Router), React 19** | Server Components let pages fetch data straight from Supabase server-side (no client round-trip, no leaking the service-role key); Route Handlers under `app/api/` give us a real backend without a separate server. |
| Styling | **Tailwind CSS v4** | Utility-first, no CSS-in-JS runtime cost; v4's `@tailwindcss/postcss` needs no separate config file. |
| Data/auth layer | **Supabase** (Postgres 17 + Auth + Storage + Realtime + RLS + pg_cron) | One platform gives us a real relational DB, row-level authorization, file storage, and a pub/sub channel (Realtime) — instead of stitching together 4 separate services. Business rules (RLS policies, RPCs, triggers) live *in* the database, so every client (bot, web, cron) automatically obeys the same rules. |
| DB access (web) | **`@supabase/ssr` + `@supabase/supabase-js`** | Cookie-based SSR sessions so Server Components can read "who is logged in" without a client-side fetch. |
| Bot | **`node-telegram-bot-api`** (long polling) | Simplest reliable way to run a Telegram bot from a single Node process without exposing a public webhook URL. |
| Scheduling | **`node-cron`** (bot) + **`pg_cron`** (DB) + **Vercel cron → `/api/cron/tick`** | Three schedulers, three jobs: `node-cron` fires the once-a-minute reminder scan and daily summaries from the bot process; `pg_cron` runs DB-only housekeeping (expiring stale requests, purging trash); the Vercel route is an *external* trigger for the failover path, not a scheduler of its own. |
| Push notifications | **`web-push`** (VAPID) | Standards-based browser push, no third-party push service (Firebase, OneSignal) or its cost/vendor lock-in. |
| Validation | **Zod** | Runtime validation for API route bodies (phone numbers, link codes) — TypeScript types alone don't validate data crossing the network. |
| Dates/timezones | **`moment-timezone`** (kept deliberately, not migrated to `Intl`) | Every medication has its own IANA timezone; `moment-timezone`'s DST-aware math must match *exactly* between the bot (`src/utils.js`) and the web app (`lib/medication-utils.ts`) or reminders fire at the wrong time — see `docs/FAQ.md`. |
| Charts | **Recharts** | Adherence charts on the dashboard. |
| Icons | **lucide-react** + a few hand-drawn SVGs (`components/ui/custom-icons.tsx`) where no stock icon fit (e.g. a two-pill "tablet" mark). |
| Billing (scaffolded) | **Razorpay** (India-first payment gateway) | Care+ subscription, implemented as a raw REST adapter (no SDK) so it's inert until keys are configured. |
| Voice calls (scaffolded) | **Exotel** (India-first telephony/IVR) | Cheapest reliable way to reach patients without a smartphone; entirely optional, behind `VOICE_CALLS_ENABLED`. |
| Hosting | **Vercel** (web) + **Render free tier** (bot/scheduler) | Vercel for the Next.js app (zero-config, great DX); Render free tier for the always-on bot process — the tradeoff being it sleeps/pauses near the end of the month, which is exactly why the failover cron route exists. |

---

## 4. Repository map

```
reminder-health/
├── index.js                  # bot process entry point (Express health check + bot + schedulers)
├── src/                       # Telegram bot + node-cron scheduler (CommonJS, service-role Supabase client)
│   ├── bot.js                 # Telegram client instance, guards against sending to synthetic web-only IDs
│   ├── commands.js             # every /command, message, and button-tap handler (1600+ lines)
│   ├── scheduler.js            # the 5 cron jobs: minute tick, weekly/morning/low-stock/caregiver summaries
│   ├── reminders.js            # shared pure helpers: dose keyboard, "time to take X" message, doses/day
│   ├── utils.js                 # calculateNextReminder (tz-aware), isValidTime, escapeHTML, snooze map
│   ├── constants.js             # state machine states, callback-action ids, menu labels
│   ├── db.js                    # Supabase client using the SERVICE ROLE key (bypasses RLS)
│   ├── plan.js                  # resolves free vs Care+ plan for a telegram id (voice-call gating)
│   ├── voice-scheduler.js       # isolated cron + lock for outbound voice-call reminders (flagged off)
│   └── voice/exotel.js          # Exotel telephony API client (voice feature only)
├── web/                        # Next.js app
│   └── src/
│       ├── app/                 # routes: (auth)/, (dashboard)/, api/, link-account/, install/, ...
│       ├── components/          # dashboard, billing, guide/tour, layout, medical, medications, ui
│       ├── lib/                 # supabase clients, reminder-events, care-circle-service, push, schedule
│       ├── hooks/                # use-realtime-notifications
│       ├── context/              # theme (light/dark), ui-mode (elderly + patient/monitor view)
│       └── middleware.ts         # refreshes the Supabase session cookie on every request
├── db/
│   ├── migrations/               # every schema change, in order — the DB's source of truth
│   ├── rollbacks/                 # matching rollback scripts for the newer migrations
│   ├── validations/                # SQL scripts used to manually verify a migration after applying it
│   └── scripts/import-medication-catalog.js  # one-off loader for the 254k-row drug catalog
├── docs/                        # ADRs, schema reference, known issues, sprint status, this file, FAQ.md
└── test/                         # node:test unit tests (bot-side utils)
```

---

## 5. File-by-file reference

### 5.1 Backend — Telegram bot & scheduler (`src/`, `index.js`)

| File | Role |
|---|---|
| `index.js` | Process entry point. Starts a tiny Express server (`/` health check, used by Render + UptimeRobot to keep the free instance awake), then — only if `TELEGRAM_BOT_TOKEN` is configured — initializes commands, the reminder scheduler, and the (flagged-off) voice scheduler. Handles `SIGINT`/`SIGTERM` to stop polling cleanly. |
| `src/bot.js` | Creates the `node-telegram-bot-api` instance (long polling). Wraps `sendMessage`/`getChat` so calls against synthetic `WEB-<uuid>` chat ids (web-only accounts that never linked Telegram) are silently skipped instead of erroring. Falls back to a no-op mock bot if no token is set, so the rest of the app can still boot in dev. |
| `src/db.js` | The bot's Supabase client, built with the **service-role key** — this bypasses Row Level Security entirely. The bot is a trusted backend, so every handler that needs cross-user access (e.g. resolving a caregiver's request) does its own manual ownership check instead of relying on RLS. |
| `src/constants.js` | All the magic strings in one place: conversation `STATES` (drug name → dosage → time → stock…), `CALLBACK_ACTIONS` (button ids), `MAIN_MENU` labels, `SNOOZE_MINUTES`/`MAX_SNOOZES`. |
| `src/utils.js` | Pure helpers used everywhere: `calculateNextReminder(times, timezone)` (the core "when does this medication next fire" function — timezone-aware, DST-safe, mirrored on the web side), `isValidTime`, `escapeHTML` (prevents Telegram HTML-parse errors/injection from user-entered drug names), and the in-memory `activeSnoozes` counter. |
| `src/reminders.js` | Small pure module extracted to stop three copy-pasted blocks in `scheduler.js` from drifting: `dosesPerDay(frequency)`, `buildDoseKeyboard(...)` (the Taken/Snooze/Skip inline buttons), `buildTakePromptMessage(...)`. |
| `src/plan.js` | `getActivePlan(telegramId)` — reads the `subscriptions` table to decide `free` vs `care_plus` (a trial counts as active until it expires). Mirrors `web/src/lib/plan.ts` exactly; used only by the voice-call feature to gate a paid capability. |
| `src/commands.js` (1612 lines) | **The bot's entire interaction layer.** Everything the user can type or tap goes through here: slash commands (`/start`, `/linkweb`), the in-memory conversational state machine for adding/editing medications and linking a caregiver, and one large callback-query handler that resolves every inline button (menus, caregiver accept/decline, dose Taken/Skip/Snooze, pagination, edit menus). See §6.2 and §8 for the workflow and the interesting engineering details (optimistic-concurrency resolution, duplicate-log prevention, secure code generation). |
| `src/scheduler.js` (892 lines) | **The bot's proactive half** — five `node-cron` jobs, the most important being the once-a-minute due-reminder scan that is the heartbeat of the whole reminder system (finds due meds → creates a `reminder_events` row → sends Telegram + browser push → advances `next_reminder_at`), plus an escalation scan, snooze-expiry re-send, and four scheduled summary jobs (weekly adherence, morning meds list, daily low-stock, nightly caregiver digest). See §6.2 and §8. |
| `src/voice-scheduler.js` / `src/voice/exotel.js` | A fully isolated, currently-inert subsystem for automated voice-call reminders (own cron, own DB lock `voice_minute_tick`, own Exotel API client). Gated behind `VOICE_CALLS_ENABLED` so it can never affect the live medication-reminder pipeline even if something in it breaks. |

### 5.2 Web app — pages & routes (`web/src/app/`)

**Root files**

| File | Type | Role |
|---|---|---|
| `layout.tsx` | Server | Root HTML shell — fonts, metadata, a pre-hydration inline script that applies the saved theme before paint (avoids a flash of wrong theme), wraps everything in `ThemeProvider`/`UiModeProvider` + service-worker registration + install prompt + cookie banner. |
| `page.tsx` | Server | `/` just redirects to `/dashboard`. |
| `manifest.ts` | Server | Generates the PWA manifest (name, icons, `start_url`, shortcuts). |
| `middleware.ts` | Edge middleware | Refreshes the Supabase auth cookie on every request and is the site's route guard: redirects unauthenticated users to `/login`, redirects logged-in users away from `/login`/`/register`, and forces unlinked accounts to `/link-account`. |
| `privacy/page.tsx`, `terms/page.tsx` | Server | Static legal pages. |
| `install/page.tsx` | Client | Standalone "Add to Home Screen" page for the PWA — detects platform/support and shows the right install UI. |
| `link-account/page.tsx` | Client | Post-registration Telegram-pairing screen; also offers "skip" (creates a web-only `WEB-<uid>` profile). |

**`(auth)/` — login/register**

| File | Type | Role |
|---|---|---|
| `layout.tsx` | Server | Shared card shell for all auth pages. |
| `login/page.tsx` | Client | Email/password sign-in + magic-link option; Cloudflare Turnstile CAPTCHA if configured. |
| `register/page.tsx` | Client | Sign-up with an 18+/Terms checkbox; redirects to `/link-account`. |
| `forgot-password/page.tsx`, `update-password/page.tsx` | Client | Standard Supabase Auth password reset flow. |

**`(dashboard)/` — the app itself**

| File | Type | Role |
|---|---|---|
| `layout.tsx` | Server | The auth/onboarding gate for the whole authenticated app: redirects to `/login` or `/link-account` as needed, signs a short-lived avatar URL, renders `Navbar` + the app shell + the guided-tour provider. |
| `dashboard/page.tsx` | Server | Fetches active medications, a 48h window of reminder events, and 7/30-day logs, then hands off to `DashboardClientView` (the big interactive dashboard — see §5.4). |
| `medications/page.tsx`, `medications/new/page.tsx`, `medications/[id]/page.tsx`, `medications/[id]/edit-form.tsx` | Mixed | Full CRUD for medications: a list page, a 6-step creation wizard, and a matching edit wizard (both write the identical set of fields via `lib/medications/form-logic.ts` so add/edit never drift). |
| `care-circle/page.tsx` | Server | "People I Care For" / "People Caring For Me" lists. |
| `care-circle/[patientId]/page.tsx` | Server | A caregiver's console for one specific patient — authorization is checked against the connection's granular `can_view_*` flags before any data is fetched. |
| `care-circle/manage/page.tsx` | Client | The "Shared Trust Center" — grant/revoke permissions, promote a primary caregiver, view the consent audit trail. |
| `care-circle/requests/page.tsx` | Client | Incoming/outgoing connection requests; all actions go through the `respond_to_caregiver_request` RPC. |
| `care-plus/page.tsx`, `care-plus/voice/*` | Mixed | Care+ subscription hub and the (flagged) voice-reminder settings page. |
| `health-vault/page.tsx`, `health-vault-client-view.tsx` | Mixed | Private document storage — categories, upload wizard, preview, trash/restore. |
| `medical-profile/page.tsx`, `medical-profile-client-view.tsx` | Mixed | Blood group, allergies, conditions, emergency contact, avatar — validated with Zod before saving. |
| `schedule-planner/page.tsx` | Client | Week/month dose timeline with drag-to-reschedule/skip. **Overrides are stored only in `localStorage`, not the database** — a deliberate, documented limitation (see `docs/FAQ.md`). |
| `settings/page.tsx`, `settings-client-view.tsx` | Mixed | Connect codes, linked caregivers/patients, sign-out, account deletion. |
| `admin-diagnostics/page.tsx` | Client | Push-delivery telemetry (subscriptions, delivery/open rates, adherence segmentation). **Note:** any logged-in user can reach this page and purge logs — there's no admin-role check, worth knowing if asked about it. |
| `emergency/page.tsx` | Server | Read-only "Emergency Card" — meant to be shown to medical staff. |

**`api/` — Route Handlers (the web app's own backend)**

| Route | Method | Role |
|---|---|---|
| `api/account/delete` | POST | GDPR-style account erasure — calls a DB RPC to wipe app data, then deletes the auth user via the service-role client. Rate-limited. |
| `api/auth/callback` | GET | Exchanges a Supabase auth code for a session; explicitly guards against open-redirect on the `next` param. |
| `api/billing/start-trial`, `subscribe`, `webhook` | POST | Care+ subscription lifecycle. `webhook` verifies the Razorpay signature with HMAC-SHA256 + `timingSafeEqual` and is a 503 no-op until configured. |
| `api/care/contact-request` | POST | Patient-initiated "please reach out" ping to all accepted caregivers (service-role, since RLS would otherwise block cross-user visibility). |
| `api/cron/tick` | GET | **The failover route.** Bearer-token protected (`CRON_SECRET`, `timingSafeEqual`). No-ops if the bot's heartbeat is fresh; otherwise takes the distributed lock and replicates the scheduler's due/escalation/snooze logic using push notifications only. See §6.5. |
| `api/link-account/redeem` | POST | Redeems a Telegram-linking code via RPC. |
| `api/push/subscribe`, `displayed`, `opened`, `acknowledge` | POST | The Web Push lifecycle — subscribe a device, then track SENT→DISPLAYED→OPENED/ACKNOWLEDGED via single-use, hashed tracking tokens. |
| `api/voice/twiml`, `response`, `status`, `verify/send`, `verify/check` | Mixed | The (flagged-off) voice-call IVR webhooks and phone-OTP verification. |

### 5.3 Web app — components (`web/src/components/`)

| Area | Key files | What they do |
|---|---|---|
| `dashboard/` | `dashboard-client-view.tsx` | The big one — see §6.2. Also generates **virtual doses** for slots that haven't fired yet, so the dashboard looks real-time instead of waiting for the bot. |
| | `med-due-gate.tsx` | Full-screen "Did you take X?" interrupt for a due dose. |
| | `medication-slider.tsx` | Drag-to-confirm slider (mouse + touch) for resolving the next dose. |
| | `todays-schedule.tsx` | Today's dose list; supports same-day Take↔Skip correction. |
| | `medication-review-queue.tsx` | Surfaces doses stuck `UNCONFIRMED` (patient never responded) for retroactive resolution. |
| | `brain-mascot.tsx` | The illustrated mascot used across onboarding/guide/due-gate. |
| `billing/` | `care-plus-card.tsx`, `care-plus-hub.tsx`, `care-plus-link.tsx` | Care+ upsell card, member hub (with a mouse-tracked tilt effect), and a nav wordmark link. |
| `guide/` | `guide-context.tsx`, `guide-tour.tsx`, `guide-content.ts`, `guide-button.tsx` | A small spotlight-overlay guided-tour engine driven by `data-tour="…"` attributes elsewhere in the DOM. |
| `layout/` | `navbar.tsx`, `dashboard-main-layout.tsx` | Top nav (notifications, theme toggle, elderly-mode toggle, profile menu) and the app shell (desktop rail / mobile bottom dock, exactly 5 nav icons by design — see memory `navbar-five-icons-mobile-first`), including the caregiver "monitor mode" patient-switcher banner. |
| `medical/` | `medical-card.tsx` | Read-only medical-profile card shown to caregivers. |
| `medications/` | `medication-list.tsx`, `medication-catalog-link.tsx`, `medication-form-options.tsx` | Medication list UI, the debounced catalog-search-and-link widget (see memory `medication-catalog-feature` — always a human choice, never auto-matched), and shared wizard option data. |
| `shared/` | `notification-center.tsx` | Navbar bell dropdown, backed by `use-realtime-notifications`. |
| `ui/` | `custom-icons.tsx`, `premium-toast.tsx` | Hand-drawn SVG icons where no stock icon fit, and the toast notification system. |
| top-level | `install-prompt.tsx`, `register-sw.tsx`, `cookie-consent.tsx`, `turnstile.tsx` | PWA install banner, app-wide service-worker registration, essential-cookies notice, and an inert-by-default Cloudflare Turnstile wrapper. |

### 5.4 Web app — lib, hooks, context (`web/src/lib/`, `hooks/`, `context/`)

**The four Supabase clients — and why there are four**

| File | Used from | Auth context | Bypasses RLS? |
|---|---|---|---|
| `lib/supabase/client.ts` | Client Components | The logged-in user's own session (browser cookies) | No |
| `lib/supabase/server.ts` | Server Components / Route Handlers | The request's own session, read via Next's `cookies()` | No |
| `lib/supabase/middleware.ts` | `middleware.ts` | Request/response cookie jar (can refresh + rewrite cookies) | No — this is the one that keeps sessions alive and does the route-guard redirects |
| `lib/supabase/service-role.ts` | Trusted server-only code (webhooks, push sender, rate limiter, cron failover) | None — uses the service-role key directly | **Yes** |

This is the standard `@supabase/ssr` pattern for Next.js: give every runtime context the *minimum*
privilege it needs, and reserve the RLS-bypassing service-role client for code that legitimately has
to act across users (sending a push to someone else, checking a rate limit that isn't tied to a
session).

**Other important files**

| File | Role |
|---|---|
| `lib/reminder-events.ts` | The **single write path** for resolving a dose. `resolveReminderEvent()` and `correctReminderEvent()` both call Postgres RPCs (`resolve_reminder_event`, `correct_reminder_event`) rather than writing `reminder_events` directly — idempotency, ownership checks, stock decrement, and escalation-clearing all happen inside the RPC, once, in one place. |
| `lib/schedule/dose-engine.ts` | Shared primitives for schedule overrides: `OverrideEntry`, `toOverrideDateStr` (keys a day by **UTC** date so the dashboard and the Schedule Planner never disagree on "today"), `parseTimeToMinutes`. Has a dependency-free `.test.ts` covering the edge cases. |
| `lib/schedule/bot-liveness.ts` | `isBotAlive()` / `isRecentlySent()` — the failover logic's building blocks; fails toward "the bot looks dead" on bad input so the web takes over rather than silently doing nothing. |
| `lib/medication-utils.ts` | The web's copy of `calculateNextReminder` — must stay behaviorally identical to `src/utils.js`'s version (both write to the same `medications.next_reminder_at` column). |
| `lib/medications/catalog.ts` | `searchMedicationCatalog()` — RPC-backed search against the 254k-row `medication_catalog` table; fails open (empty results) rather than blocking medication entry if the catalog is unreachable. |
| `lib/medications/form-logic.ts` | Shared validation + field-building logic used by both the "new" and "edit" medication wizards, so they can never drift apart on what they write. |
| `lib/plan.ts` | Server-side Care+ plan resolver (mirrors `src/plan.js`). |
| `lib/razorpay.ts`, `lib/sms.ts` | Inert-until-configured adapters for Razorpay billing and SMS OTP (MSG91/Exotel). |
| `lib/rate-limit.ts` | `checkRateLimit()` — fixed-window rate limiting via a Postgres RPC; **fails open** (allows the request) on a DB error, deliberately, so a transient outage never locks users out. |
| `lib/severity-theme.ts` | Maps a medication's priority to consistent colors/icons everywhere it's shown. |
| `lib/push/register-push.ts` | Client-side push subscription flow (permission request → `PushManager.subscribe` → POST to `/api/push/subscribe`). |
| `lib/push/send-push.ts` | Server-side push sender, ported from the bot's `sendBrowserPush` so the failover cron can send push without needing the bot process at all. |
| `lib/supabase/cached-queries.ts` | Request-deduped (`React.cache`) data loaders, including `resolveUserData()` which figures out "who is this request effectively about" (self, or a caregiver's monitored patient) and self-heals a missing `profiles` row via the `ensure_my_profile` RPC. |
| `lib/supabase/care-circle-service.ts` | All server-side caregiver/patient relationship queries and mutations — connection lists, permission updates, primary-caregiver promotion, a computed 0–100 "relationship health score", consent audit history. |
| `hooks/use-realtime-notifications.ts` | Subscribes to a Supabase Realtime channel on `notifications` (filtered to the current user) and keeps the bell dropdown live. |
| `context/theme-context.tsx` | Light/dark theme; defaults to **time-of-day** (dark 7pm–7am) until the user makes an explicit choice, which then wins permanently. |
| `context/ui-mode-context.tsx` | Two independent bits of state: Elderly Mode (`localStorage`) and Patient/Monitor view (a **cookie**, so server components and middleware can read it too). |

### 5.5 Database (`db/`)

`db/migrations/` is the literal, chronological history of the schema (45+ files) — this is genuinely
the best way to see how the data model evolved, e.g. `migration_caregiver_decoupling_phase_a.sql` →
`migration_carecircle_universal_connect.sql` → `migration_carecircle_respond_rpc.sql` tell the exact
story behind ADR-003 through ADR-006 below. `db/rollbacks/` holds matching down-migrations for the
newer changes; `db/validations/` holds the manual verification SQL run after applying each migration
(the sandbox this project developed in blocks direct Postgres TCP access, so migrations are applied by
hand through the Supabase SQL editor — see `docs/KNOWN_ISSUES.md`).

Full table/RPC/trigger inventory lives in `PROJECT.md` §5–7 and `docs/DATABASE_SCHEMA.md` — not
repeated here to avoid drift. The short version worth memorizing:

- **16 tables, RLS enabled on every one.**
- **Identity/relationships:** `profiles`, `caregiver_info` (legacy identity directory only),
  `caregiver_connections` (source of truth for who-cares-for-whom, many-to-many), `active_caregiver_links`
  (compatibility view unioning both).
- **Reminders:** `medications`, `reminder_events` (the live state machine), `reminder_logs` (history for charts).
- **Notifications/push:** `notifications`, `push_subscriptions`, `push_logs`, `push_tracking_tokens`.
- **Health Vault:** `health_categories`, `health_records`.
- **Everything privileged goes through a SECURITY DEFINER RPC** (`invite_caregiver`, `respond_to_caregiver_request`, `resolve_reminder_event`, `ensure_my_profile`, …) so the client never has to be trusted to write another user's rows correctly — the database enforces it.

---

## 6. Core workflows, end to end

### 6.1 Auth & onboarding

1. `register/page.tsx` calls `supabase.auth.signUp`.
2. A DB trigger `handle_new_user` fires and creates the `profiles` row (`role = PATIENT`,
   `telegram_chat_id = 'WEB-<uuid>'` as a placeholder) plus default Health Vault folders
   (`handle_new_user_health_categories`).
3. The user lands on `/link-account`: either enters a Telegram pairing code (generated by `/linkweb`
   in the bot) to bind their real chat id, or skips and stays web-only.
4. On every subsequent request, `middleware.ts` → `lib/supabase/middleware.ts` refreshes the session
   cookie and redirects to `/link-account` if `telegram_chat_id` still looks like a `WEB-` placeholder
   and the route requires linking.
5. If a `profiles` row is ever missing (e.g. manual DB cleanup), `resolveUserData()` self-heals it via
   the `ensure_my_profile()` RPC instead of the account being stranded.

### 6.2 The reminder lifecycle (the core engine)

```
SENT → DISPLAYED → OPENED → GENTLE_REMINDER → ESCALATED → CAREGIVER_ACKNOWLEDGED
                                                       ↘
                                          → TAKEN | SKIPPED | SNOOZED | UNCONFIRMED
```

1. **Every minute**, `src/scheduler.js`'s minute-tick job acquires a DB-backed distributed lock
   (`try_acquire_scheduler_lock`), then scans `medications` for anything due. For each due dose it
   *claims* the row with an optimistic-concurrency update (`WHERE last_sent_at = <expected>`) before
   sending anything, inserts a `reminder_events` row (a DB unique constraint on
   `(medication_id, scheduled_for)` is the final backstop against duplicates), sends the Telegram
   message, and fires a browser push via `web-push`.
2. Meanwhile, the **web dashboard** (`dashboard-client-view.tsx`) generates **virtual doses**
   client-side for any of today's slots that don't have a real event yet — so the UI looks live even
   before the scheduler has actually fired. Once a real `reminder_events` row exists, it takes over.
3. The patient responds — via a Telegram inline button (handled in `src/commands.js`) or the web
   dashboard (`resolveReminderEvent()` in `lib/reminder-events.ts`). Both paths funnel into the same
   `resolve_reminder_event` RPC, which validates ownership and, for virtual doses, that the requested
   time actually matches one of the medication's configured `reminder_times`.
4. If nobody responds in time, `scan_and_escalate_overdue_reminders()` (called every minute from the
   scheduler) advances the event `SENT → GENTLE_REMINDER → ESCALATED`, and on escalation every
   caregiver with `can_receive_escalations` gets a Telegram alert with Acknowledge/Confirm-Taken
   buttons.
5. At day's end, `close_daily_medications()` marks anything still unresolved `UNCONFIRMED`; it then
   shows up in the web dashboard's "Help Us Complete Your Medication History" review queue.
6. If the patient took the dose late or skipped by mistake, `todays-schedule.tsx` lets them correct it
   *same-day only* via `correctReminderEvent()` — stock is automatically compensated by a DB trigger.

### 6.3 Care Circle — invite → accept

1. A user "becomes a caregiver" (bot: `CG_BECOME` callback, web: settings page) and gets a unique
   `CG######` id (`caregiver_info`).
2. The patient enters that code. `lookup_caregiver_by_code()` resolves it; `invite_caregiver()`
   (SECURITY DEFINER — direct client `INSERT` is RLS-blocked) creates a `PENDING`
   `caregiver_connections` row.
3. A trigger (`handle_caregiver_connection_trust_events`) writes the caregiver's in-app notification —
   the client is never allowed to write a notification for someone else directly.
4. The caregiver accepts/declines via `respond_to_caregiver_request()` (web) or the bot's "Pending
   Requests" panel (service-role update, but the code re-checks ownership manually since RLS doesn't
   apply to the bot's client).
5. On first accept, a trigger auto-assigns the caregiver as primary; on revoke, another trigger
   promotes a replacement, guarded by a transaction-local bypass flag so it doesn't trip the normal
   state-transition validation trigger.
6. All permission grants (`can_view_medications`, `can_view_vault`, `can_receive_escalations`, …) are
   managed per-connection in `care-circle/manage/page.tsx` and every change is written to
   `caregiver_connection_audit_logs`.

### 6.4 Health Vault

Upload wizard (category → file → details → save) writes to the private `health-vault` Supabase Storage
bucket and a `health_records` metadata row. Preview uses short-lived signed URLs; PDFs render inline on
desktop but open in the device's native viewer on mobile (inline PDF preview is unreliable on mobile
browsers). Deletes are soft (`deleted_at`) with a 30-day trash window before a scheduled job purges
them permanently.

### 6.5 Failover — what happens if the bot goes down

Render's free tier gives the bot ~750 instance-hours/month, so it can pause near month-end. The
mitigation (documented in `docs/KNOWN_ISSUES.md`): the bot writes a `scheduler_heartbeat` row on every
successful tick. An external cron pings `web/src/app/api/cron/tick` every minute; that route is a
**total no-op** while the heartbeat is fresh, and only when it's stale (>180s old) does it take the
same distributed lock and replicate the due/escalation/snooze logic itself — sending push notifications
only (Telegram delivery lives in the paused bot process, so it can't help). Exactly-once delivery is
still guaranteed by the same lock + unique-constraint mechanisms described in §6.2, so the two code
paths can never double-send.

---

## 7. Security model (say this if asked "how do you handle authorization?")

- **RLS is enabled on all 16 tables.** Users can only read/write rows that belong to them
  (`auth.uid()` or their `telegram_chat_id`).
- **Every cross-user write goes through a SECURITY DEFINER RPC** — inviting a caregiver, accepting a
  request, resolving a reminder, creating a notification for someone else. The client is never trusted
  to perform these correctly on its own.
- **ReBAC, not just role-based access**: caregiver permissions are granular columns on the specific
  `caregiver_connections` row (`can_view_medications`, `can_view_vault`, `can_edit_medications`,
  `can_receive_escalations`), not a single global "is this person a caregiver" flag — so a patient can
  share adherence with one caregiver but not their documents with another.
- **RLS-recursion-safe helper functions** (`get_my_telegram_chat_id()`, `are_profiles_connected()`) —
  written as SECURITY DEFINER with an explicit `search_path` so RLS policies that would otherwise
  self-join and recurse infinitely instead resolve in one pass (ADR-001).
- **The Telegram bot deliberately bypasses RLS** (service-role key) because it's a trusted backend —
  but every handler that touches another user's data (accepting a caregiver request on someone's
  behalf) does an explicit manual ownership check as a substitute for the RLS it doesn't get.
- **Secrets are never stored in plaintext**: Telegram-linking codes and push tracking tokens are
  generated with `crypto.randomInt`/`randomBytes` and only their SHA-256 hash is stored; OTP codes for
  phone verification follow the same pattern.
- **Webhook/cron authenticity** is checked with constant-time comparison (`timingSafeEqual`) —
  Razorpay's webhook signature and the cron route's bearer secret both use this to avoid timing attacks.

---

## 8. Engineering talking points (things worth bringing up unprompted)

- **Optimistic concurrency instead of table locks**: every state transition on `reminder_events` (or
  `medications.last_sent_at`) is a conditional `UPDATE ... WHERE column = <expected value>`. Two
  simultaneous actors (patient tapping "Taken" on Telegram while a caregiver taps "Confirm Taken" on
  web) can race safely — only one write succeeds, the other sees zero rows affected and backs off.
- **Layered idempotency on "did we already send this reminder"**: an in-process time check, an
  optimistic-concurrency claim on the medication row, *and* a DB unique constraint as the final
  backstop. Three independent layers because any one of them failing silently would mean duplicate (or
  missed) reminders — a genuinely dangerous bug for a medication app.
- **State machines live in the database, not just in code**: `scan_and_escalate_overdue_reminders()`
  and `close_daily_medications()` are Postgres functions, so the escalation timing logic is
  transactional and identical no matter which client (bot or web-failover) triggers it.
- **Defense in depth even with a trusted backend**: the bot uses the service-role key (bypasses RLS)
  but still re-checks ownership manually before every privileged write — a good example of not relying
  on a single security layer.
- **A real production incident and its fix**: `docs/ARCHITECTURE_DECISIONS.md` (ADR-006) documents that
  under the original design, *no one* could actually accept a caregiver request — RLS blocked the
  caregiver from writing `ACCEPTED`, and SECURITY DEFINER doesn't change `auth.uid()`, so the validation
  trigger still fired as if the patient were making the change. Fixed by relaxing the trigger to permit
  that specific role/transition pair, with an internal-bypass GUC for genuinely system-initiated writes
  (primary-caregiver reassignment). Good story about diagnosing an RLS+trigger interaction bug.
- **A perf refactor with before/after**: the nightly caregiver-summary job in `scheduler.js` was
  N+1 (one query per caregiver-link) and was rewritten to two batched `IN`-queries plus a name cache,
  explicitly documented in-code as a byte-identical-output performance fix.
- **Fail-open vs fail-closed, chosen deliberately per feature**: rate limiting fails *open* (never
  lock a user out over a transient DB hiccup); catalog search fails *empty* (never block adding a
  medication); bot-liveness detection fails *dead* (the web cron takes over rather than assuming the
  bot is fine); push sending never throws (a failed push must never break the primary Telegram send).
- **Human-in-the-loop by design**: the medication-catalog linking feature never auto-matches a
  nickname to a real drug — the user always explicitly picks — because an incorrect automatic match in
  a medication app is a patient-safety issue, not just a UX inconvenience.
- **A known, deliberate scope limitation**: Schedule Planner overrides live only in `localStorage`, not
  the database — worth naming proactively if asked "does rescheduling actually change when the
  reminder fires" (it doesn't yet; that's a documented future feature, not a bug you didn't notice).

---

## 9. Deployment topology

- **Web** → Vercel project `reminder-health` (monorepo, `directory: web`), deployed from the **repo
  root** (`npx vercel deploy --prod --yes`) — not from inside `web/`, whose own `.vercel` config
  accidentally points at a different project.
- **Bot/scheduler** → Render free-tier service `reminder-health.onrender.com`, kept awake by an
  UptimeRobot ping against the Express health-check route; can still exhaust its monthly free hours
  near month-end, which is exactly the scenario §6.5's failover route protects against.
- **Database** → Supabase project `jaflclnakwtikqbfhfdk`. Schema changes are written as `.sql` files
  under `db/migrations/` first (source of truth) and then applied by hand via the Supabase SQL editor.

---

## 10. Where to go deeper

- `PROJECT.md` — terse reference (schema, RPC table, trigger list) — this walkthrough's companion.
- `docs/DATABASE_SCHEMA.md` — full column-level schema reference.
- `docs/ARCHITECTURE_DECISIONS.md` — every ADR, with the reasoning and the bug that prompted it.
- `docs/KNOWN_ISSUES.md` — honest list of what's still rough, resolved-and-verified, or intentionally deferred.
- `docs/VOICE_CALLS_DESIGN.md` — full design for the scaffolded, currently-off voice-call feature.
- [`docs/FAQ.md`](FAQ.md) — plain-English tech glossary + troubleshooting Q&A (read this next).
