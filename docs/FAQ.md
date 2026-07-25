# Re-MIND-eЯ — FAQ, Tech Glossary & Troubleshooting

Companion to [`docs/PROJECT_WALKTHROUGH.md`](PROJECT_WALKTHROUGH.md). That doc explains *what the
project is*; this one exists so you never freeze up on "wait, what does that actually do / mean" —
whether it's a technology you haven't touched before, or a question a technical interviewer is likely
to ask about a decision you made.

---

## Part 1 — Technology glossary (plain English)

### Next.js App Router & React Server Components
Next.js is a React framework. The **App Router** (the `web/src/app/` folder structure) means every
folder is a URL segment, and every `page.tsx` is that route's page. The big shift from older Next.js
(and from plain React) is **Server Components**: a `page.tsx` *without* `'use client'` at the top runs
only on the server, can talk directly to Supabase, and never ships its data-fetching code to the
browser. Add `'use client'` at the top of a file and it becomes a normal interactive React component
that runs in the browser (needed for anything with `useState`, `onClick`, etc.). In this project,
most `page.tsx` files are Server Components that fetch data and pass it down; most `*-client-view.tsx`
files are the interactive Client Component that data gets handed to. **Route Handlers** (`app/api/*/route.ts`)
are how you write a traditional backend endpoint inside the same app — `export async function POST(req)`.

### Supabase
A hosted platform on top of Postgres that bundles four things this project uses:
1. **Postgres database** — the actual tables.
2. **Auth** — email/password (and magic-link) user accounts, issuing a session stored in cookies.
3. **Storage** — an S3-like file store (used for the Health Vault and avatars), with the same
   row-level-security model as the database.
4. **Realtime** — a WebSocket channel that pushes out database changes (`postgres_changes`) live to
   subscribed clients — this is how the notification bell updates without a page refresh.

### Row Level Security (RLS)
A Postgres feature: you write a policy on a table like "a user may only `SELECT` rows where
`user_id = auth.uid()`", and the database enforces it on *every* query, no matter which client sent
it. This means even if a bug let someone craft an arbitrary Supabase query from the browser, they
still couldn't read another user's data — the enforcement isn't in the application code, it's in the
database engine itself.

### RPC / SECURITY DEFINER function
An **RPC** here means a Postgres function you call from the client like an API endpoint
(`supabase.rpc('resolve_reminder_event', {...})`) instead of writing raw `INSERT`/`UPDATE` from the
client. **SECURITY DEFINER** means the function runs with the *permissions of the function's owner*
(effectively admin), not the calling user's — so it can do things RLS would otherwise block (like
writing a notification into someone else's inbox), while the function's own code decides exactly what's
allowed. This project uses this pattern for every action that needs to safely cross between two users'
data (invite a caregiver, accept a request, resolve a reminder).

### Trigger
A Postgres function that runs automatically when a row is inserted/updated/deleted — no application
code has to remember to call it. Used here for things that must *always* happen alongside a state
change and should never be forgettable, like creating a notification whenever a caregiver connection
changes state, or decrementing medication stock whenever a dose is marked Taken.

### `pg_cron` vs `node-cron`
Both run something "every N minutes," but in different places. `pg_cron` runs **inside Postgres** —
used here for pure housekeeping that doesn't need any external service (expiring stale requests,
purging old trash). `node-cron` runs **inside the bot's Node.js process** — used for the actual
reminder-sending logic, because it needs to call the Telegram API and the Web Push API, which Postgres
can't do on its own.

### Web Push / VAPID
The browser-native way to send a notification to a device even when the site's tab isn't open, without
going through a third-party push provider (Firebase, OneSignal, etc.). The browser gives you a
`PushSubscription` (an endpoint URL + two keys) when the user grants permission; you store that, and
your server later sends an encrypted push through it using the `web-push` library. **VAPID** is the
signing scheme (a public/private keypair for your server) that lets the push service (e.g. Google's
FCM under the hood) verify that the push really came from you and not someone else.

### Service Worker & PWA install
A **service worker** (`web/public/sw.js`) is a background script the browser runs even when your site
isn't open — it's what actually *receives* the push event and shows the OS-level notification. It's
also a prerequisite for the browser's "Add to Home Screen"/**PWA install** prompt
(`beforeinstallprompt` event) to become available at all — which is why `register-sw.tsx` registers
the service worker app-wide on every page load, not just after the user grants notification
permission.

### Realtime subscription
`supabase.channel(...).on('postgres_changes', {...}, callback).subscribe()` — opens a WebSocket and
calls your callback whenever a row matching the filter changes. Used for live notification-bell
updates and to refresh the dashboard when a reminder's status changes on another device.

### Zod
A TypeScript-first schema-validation library. TypeScript types are compile-time only — they don't
protect you from a malformed JSON body hitting an API route at runtime. Zod schemas (`z.object({...})`)
validate *and* type the data in one step, used here on API routes that accept user input (phone
numbers, link codes).

### `moment-timezone`
A JavaScript library for timezone-aware date math, including daylight-saving-time transitions. This
project deliberately did **not** migrate it to the newer native `Intl`/`Temporal` APIs, because the web
app's copy of the "next reminder time" calculation must match the bot's copy exactly — and rewriting
one side risks a subtle DST-edge-case mismatch that would make reminders fire at the wrong time for
some users, some of the year. Not worth the risk for what would otherwise be a routine
formatting-library swap.

### IANA timezone
The `"Asia/Kolkata"`-style identifiers (as opposed to a raw UTC offset like `+05:30`) are the industry
standard because they encode the *rules*, not just the current offset — so DST transitions are handled
correctly automatically. Every medication stores its own IANA timezone so reminder math is correct
regardless of where the patient or their caregiver physically is.

### Idempotency
"Doing the same operation twice has the same effect as doing it once." Comes up constantly in this
codebase because reminders get sent from a distributed system (multiple bot instances possible during
a deploy, plus a failover cron) — see the unique constraint on `reminder_events(medication_id,
scheduled_for)` and the `push_logs` upsert keyed by `(event_id, status)`.

### Optimistic concurrency control (compare-and-swap)
Instead of locking a row before you read it, you read it, decide what to do, then write with a
condition: `UPDATE ... WHERE id = X AND status = <the status you read>`. If someone else changed the
row in between, the `WHERE` clause matches zero rows and your write silently does nothing — you check
`rowsAffected === 0` and know you lost the race. Cheaper than real locking, and this project uses it
everywhere a reminder's state might be touched by two actors at once (patient vs. caregiver, bot vs.
web-failover).

### ReBAC (Relationship-Based Access Control)
Instead of a single global role ("this user is a caregiver, full stop"), permissions are attached to
the specific *relationship* between two people — e.g. Alice can grant Bob `can_view_medications` but
not `can_view_vault`, while granting Carol both. More flexible than RBAC (Role-Based Access Control)
for anything modeling real human trust relationships.

### Distributed lock
A way to make sure only *one* of several running processes does something at a time, even though they
can't directly talk to each other. Implemented here as a row in a Postgres table with a TTL: a process
tries to `INSERT`/`UPDATE` a "lock" row claiming ownership; if it dies before releasing it, the TTL
expiry lets another process take over automatically rather than deadlocking forever.

### CAPTCHA (Cloudflare Turnstile)
A bot-detection widget shown on login/register forms. This project's integration is inert by default
(`components/turnstile.tsx` renders nothing unless a site key env var is set) — it was built to be
optional so local development never requires solving a CAPTCHA.

### Razorpay / Exotel (scaffolded, not live)
**Razorpay** is an India-focused payments gateway (used here for the Care+ subscription, implemented
as a raw REST client with no SDK dependency). **Exotel** is an India-focused cloud telephony/IVR
provider (used for the scaffolded automated voice-call reminders). Both are intentionally "dark" —
their code paths exist and are tested against, but return 503/404 until their API keys are configured,
so shipping the code has zero effect on the live product until someone flips the switch.

---

## Part 2 — Common questions & answers

### Architecture

**Q: Why three separate "surfaces" (bot, web, cron) instead of one app?**
Historical + practical. The Telegram bot was the V1 MVP and remains the best experience for elderly,
non-technical, or non-smartphone-app users. The web app added the things Telegram fundamentally can't
do well (caregiver dashboards, document storage, rich account management). The cron route isn't really
a "surface" from the user's perspective — it's pure infrastructure redundancy for when the bot's free
hosting tier pauses.

**Q: If there are three things writing reminders, how do you stop them from double-sending?**
Layered idempotency, not a single mechanism: a unique DB constraint on `reminder_events(medication_id,
scheduled_for)` is the hard backstop no matter which process writes; a distributed lock means only one
process is even trying at a given minute; the web-failover route is additionally gated to be a
complete no-op unless the bot's heartbeat is stale. See `docs/PROJECT_WALKTHROUGH.md` §6.2/§6.5 and
`docs/KNOWN_ISSUES.md` ("Minute-Tick Scheduler Single Point of Failure").

**Q: Why does the bot use the Supabase service-role key instead of a normal user session?**
The bot isn't acting as any single logged-in user — it's a backend service that needs to read/write
across all users (send Alice's reminder, notify Bob's caregiver). RLS is designed around
`auth.uid()` from a browser session, which the bot doesn't have. So the bot is explicitly a *trusted*
backend, and every handler that touches another user's data does its own manual ownership check in
code as a substitute for the RLS protection it opts out of.

**Q: Why four different Supabase client files in `lib/supabase/`?**
Each one is scoped to the minimum privilege its runtime context needs: browser session, server session,
middleware (which can also rewrite cookies to refresh the session), and the one RLS-bypassing
service-role client used only by trusted server-only code (webhooks, the push sender, rate limiting,
the cron failover). Keeping them separate means it's obvious at the import line whether a given file
can act as "any user" or only "the logged-in user."

### Reminders & scheduling

**Q: What's a "virtual" dose vs a "real" reminder event?**
A real dose is a row in `reminder_events`, created once the scheduler actually fires. A virtual dose
is generated **client-side only**, in the browser, for today's slots that haven't fired yet — so the
dashboard shows "next dose in 20 minutes" immediately rather than waiting for the once-a-minute
scheduler tick to catch up. It has a synthetic negative id and disappears/gets replaced the moment a
real event exists. When a user resolves a virtual dose, the RPC creates the real row at that moment.

**Q: Why does the scheduler compute `next_reminder_at` instead of just checking "is now == HH:MM"?**
Storing an explicit next-fire timestamp means the minute-tick query is a single cheap indexed
`WHERE next_reminder_at <= now()` instead of re-deriving "is this medication due" from its full
`reminder_times` array on every single tick for every single medication.

**Q: Does the Schedule Planner actually change when reminders fire?**
No — this is a known, deliberate limitation. Overrides (drag-to-reschedule, skip) are saved only in
the browser's `localStorage`, so they change what the *planner view* shows but not the underlying
`medications.reminder_times`/`next_reminder_at` that the scheduler actually reads. It's documented as
a future feature in `docs/KNOWN_ISSUES.md`, not a bug that was missed.

**Q: Why isn't `frequency` (e.g. "every other day") actually honored by the reminder engine?**
Also a known, documented gap — `calculateNextReminder` expands `reminder_times` every day regardless
of `frequency`, so `every_other_day`/`weekly` medications currently fire daily in practice. The add/edit
forms only expose once/twice/thrice-daily for this reason; true off-day scheduling would need changes
to the core time-calculation function on both the bot and web sides, plus new tests — see
`docs/KNOWN_ISSUES.md`.

**Q: Why is timezone handling per-medication instead of per-user?**
A caregiver might live in a different timezone than the patient they're monitoring, and a patient could
travel. Storing the IANA timezone on the medication itself (defaulting to `Asia/Kolkata`) means the
reminder always fires at the *patient's* local wall-clock time regardless of who's looking at the
dashboard or where the server runs.

### Care Circle / permissions

**Q: Why can't a caregiver just be inserted directly into `caregiver_connections`?**
RLS on that table only allows a patient to see/manage their own connections and a caregiver to see/manage
theirs — a direct `INSERT` from either side would either be blocked outright or would let a client
bypass validation (e.g. setting itself straight to `ACCEPTED`, or setting permissions it shouldn't have).
`invite_caregiver()` and `respond_to_caregiver_request()` are SECURITY DEFINER RPCs specifically so the
*server-side function*, not the client, decides what fields are allowed to be set at each step.

**Q: Can one person be both a patient and a caregiver?**
Yes — `profiles.role` is a default hint, not an exclusivity constraint. "Is a caregiver" really means
"has an active CG-ID," independent of the role column, so a single account can invite caregivers for
itself while also monitoring someone else.

**Q: What stops a caregiver from seeing a patient's Health Vault if it wasn't shared with them?**
The `can_view_vault` flag lives on the specific `caregiver_connections` row and every vault query is
filtered through it (plus RLS on `health_records` itself); it's per-relationship, not a blanket
"caregivers can see everything."

### Database / Supabase

**Q: Why RLS *and* SECURITY DEFINER RPCs — isn't that redundant?**
They solve different problems. RLS is the default-deny baseline: without it, any authenticated user
could query any row from the client. SECURITY DEFINER RPCs are the deliberate, narrow *exceptions* to
that baseline for the specific privileged actions the product needs (one user's action legitimately
needing to write into another user's data, like a notification or an accepted connection). Everything
that isn't explicitly routed through an RPC still hits the default-deny RLS wall.

**Q: What was the RLS "infinite recursion" bug (ADR-001) about?**
A policy on table A that checks table B, whose own policy checks back into table A, can make Postgres
recurse until it hits the stack depth limit and errors. The fix was writing small SECURITY DEFINER
helper functions (`are_profiles_connected()`, etc.) with an explicit `search_path` — calling a function
from inside a policy runs outside the normal RLS-policy-evaluation stack, breaking the recursive loop.

**Q: Why apply migrations by hand through the Supabase SQL editor instead of a migration tool/CI?**
A concrete, documented constraint: this project's development sandbox blocks direct outbound Postgres
TCP traffic (ports 5432/6543), so a programmatic migration runner (`pg` client, Supabase CLI push)
can't reach the database from that environment. The `.sql` files under `db/migrations/` remain the
real source of truth and are applied manually — see `docs/KNOWN_ISSUES.md`.

### Web / frontend

**Q: Why does the theme default to "dark after 7pm" instead of just following the OS setting?**
A deliberate UX choice for an app used by elderly patients late at night (checking a reminder before
bed) — auto-dimming reduces glare without requiring the user to know their OS even has a dark-mode
setting. Any explicit manual choice always overrides the automatic behavior permanently.

**Q: Why exactly 5 nav icons?**
A deliberate mobile-first constraint (see project memory) — more than 5 doesn't fit comfortably in a
thumb-reachable bottom bar on a phone, so anything beyond the core 5 (Dashboard, Medications, Schedule,
Health Vault, Settings) lives inside the profile/settings menu instead of competing for nav space.

**Q: Why is medication-catalog linking always manual, never automatic?**
Patient safety. Auto-matching a free-text nickname to a real drug entry risks linking the wrong
medication silently — a UX inconvenience anywhere else, but potentially dangerous in a medication app.
The feature is intentionally "search and let the human confirm," never "guess and apply."

### Push notifications / PWA

**Q: A push tracking token — what's it actually protecting against?**
It authorizes a specific unauthenticated action (marking a specific reminder event as
displayed/opened/acknowledged) *without* requiring the recipient to be logged in inside the service
worker context, while still preventing anyone else from forging that callback for an event that isn't
theirs. The token is random, only its hash is stored server-side, and (for the "opened" action) it's
deleted after use so it can't be replayed.

**Q: Why is `register-sw.tsx` separate from the push-permission flow?**
Because `beforeinstallprompt` (the "Add to Home Screen" trigger) requires an active service worker to
even become eligible — and previously the service worker only registered after a user granted
notification permission. That meant a first-time visitor who hadn't yet granted push permission could
never see the install prompt either. Registering the service worker app-wide, independent of push
permission, fixed that — see git history: commit "register service worker app-wide so install prompt
can fire".

### Deployment / ops

**Q: Why deploy from the repo root instead of `web/`?**
The Vercel project `reminder-health` is configured as a monorepo link at the repo root with
`directory: web`. `web/.vercel/` has its own (incorrect) project link left over from an earlier setup,
pointing at a different Vercel project (`reminder-health-web`) — deploying from inside `web/` would
silently ship to the wrong place.

**Q: Why does the bot occasionally stop responding for a day or two near month-end?**
Render's free tier caps monthly instance-hours (~750); an always-on Node process uses close to all of
them, so the service can pause until the billing cycle resets on the 1st. This is exactly the scenario
the `/api/cron/tick` failover route exists for — while the bot is paused, Telegram delivery is
unavailable (it's the same process), but browser push reminders keep firing via the failover route.

---

## Part 3 — Troubleshooting playbook

| Symptom / error | Likely cause | Where to look |
|---|---|---|
| `INVALID_SCHEDULED_TIME` from `resolve_reminder_event` | The client computed a virtual dose's `scheduled_for` in the wrong timezone (e.g. browser's local zone instead of the medication's own IANA zone) | `dashboard-client-view.tsx` virtual-dose generation; must match `medication.timezone`, not `Intl.DateTimeFormat().resolvedOptions().timeZone` |
| `CORRECTION_WINDOW_EXPIRED` when trying to fix a Taken/Skipped dose | Same-day correction window has passed — this is intentional, not a bug | `lib/reminder-events.ts` `correctReminderEvent()` — the error message is pattern-matched by callers |
| A reminder fires twice for the same dose | Should be structurally impossible (unique constraint on `reminder_events`), but if seen: check whether two scheduler instances were running simultaneously during a deploy, or whether the distributed lock RPC (`try_acquire_scheduler_lock`) failed silently | `src/scheduler.js` minute-tick job; check for `23505` (duplicate key) log lines — those are the *expected*, handled case |
| Postgres error mentioning stack depth / recursion inside an RLS policy | A new/edited RLS policy joins back into a table whose own policy references the first table | Use the existing helper-function pattern (`are_profiles_connected`, `get_my_telegram_chat_id`) instead of a raw subquery — see ADR-001 |
| A caregiver can't accept a request; the request silently fails | Check `validate_caregiver_connection_updates` — this exact bug happened once (ADR-006): the trigger didn't permit the caregiver-initiated `PENDING → ACCEPTED` transition | `docs/ARCHITECTURE_DECISIONS.md` ADR-006 |
| Push notifications stop arriving for a user | Subscription may have expired (browser returns 410/404 on send) — the sender deletes it automatically, but the user needs to re-subscribe (reload the app with notification permission still granted) | `lib/push/send-push.ts`, `push_logs` table (`admin-diagnostics` page shows delivery/open rates) |
| A route that calls `createServiceClient()` 500s in production only | Missing `SUPABASE_SERVICE_ROLE_KEY` env var in that specific deployment environment (this happened for real — see `docs/KNOWN_ISSUES.md` "Minute-Tick Scheduler Single Point of Failure") | Check Vercel/Render environment variables, not the code |
| Reminders fire at the wrong wall-clock time for a specific medication | `medications.timezone` is wrong/blank for that row, or the bot's and web's `calculateNextReminder` copies have drifted out of lockstep | `src/utils.js` vs `web/src/lib/medication-utils.ts` — both must be edited together, always |
| Deploying the web app seems to have no effect | Deployed from `web/` instead of the repo root, hitting the wrong Vercel project | Always run `npx vercel deploy --prod --yes` from the repo root |
| Bot stops responding to everyone for a day or two | Render free-tier instance-hours exhausted for the month | Confirm via Render dashboard; the `/api/cron/tick` failover should already be covering push delivery in the meantime |
| A migration you wrote doesn't seem to be live | Migrations aren't auto-applied — the `.sql` file must be run manually in the Supabase SQL editor | `db/migrations/`, then verify with the matching script in `db/validations/` |

---

## Part 4 — "Why did you build it this way?" cheat sheet

Short, confident answers for the questions most likely to come up in a walkthrough or interview:

- **"Why Supabase instead of rolling your own backend?"** — I wanted real relational data with proper
  authorization *enforced at the database layer*, not just in application code, because this app has
  three different clients (bot, web, cron) that all need to obey the exact same rules. Rolling my own
  API would mean re-implementing that authorization logic three times or funneling everything through
  one more service; Supabase's RLS + RPC model let the database itself be the single enforcement point.

- **"Why not just poll for reminders from the client instead of a server-side scheduler?"** — Because
  reminders have to arrive even when nobody has the app open — that's the entire point of a medication
  reminder. It has to be a server-side process (the bot's `node-cron` job) pushing out to Telegram and
  Web Push, not the client pulling.

- **"Isn't three overlapping scheduling mechanisms (`pg_cron`, `node-cron`, Vercel cron) overkill?"** —
  They don't overlap in responsibility: `pg_cron` only does pure-database housekeeping that needs no
  external API access; `node-cron` is the one that actually sends reminders because it's the only one
  that can call Telegram/Web Push; the Vercel cron route is a no-op unless the primary scheduler is
  provably down. It looks like three schedulers but it's really one active scheduler plus a dormant
  backup.

- **"What would you do differently if you rebuilt this today?"** — Good honest answer: extract
  `calculateNextReminder` into a single shared package instead of two hand-synced copies (bot + web),
  and give the Schedule Planner's overrides a real server-side table instead of `localStorage` — both
  are already tracked as open items in `docs/KNOWN_ISSUES.md`, not things I'm unaware of.
