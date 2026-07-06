# Re-MIND-eЯ — Known Issues

This document lists confirmed bugs, technical limitations, and security issues in the Re-MIND-eЯ application.

---

## 1. Active Issues (P0/P1)

### Care Circle Overwrite & Limit Bug
- **Status**: Under Remediation (Sprint 5.7B Corrective)
- **Problem**: Caregiver connection relationships are stored across both the legacy `caregiver_info` table and the new `caregiver_connections` table. Linking a second caregiver overwrites the patient's existing caregiver entry, restricting Care Circle connections.
- **Remediation**: Shift relationship tracking to `caregiver_connections` as the single source of truth.

### Request Notifications RLS Failure
- **Status**: Under Remediation (Sprint 5.7B Corrective)
- **Problem**: Patient browser tries to write notification rows directly to caregivers' inbox in the `notifications` table, which is blocked by Row-Level Security policies.
- **Remediation**: Transition notification creation to database-level security definer triggers.

### Timezone Mismatches on Virtual Events
- **Status**: Under Remediation (Sprint 5.7B Corrective)
- **Problem**: Client browser generates virtual events using the client's local browser timezone (e.g. UTC). This mismatch with the medication's database timezone (e.g. Asia/Kolkata) causes incorrect `scheduled_for` parameters, resulting in `INVALID_SCHEDULED_TIME` RPC failures.
- **Remediation**: Use `moment-timezone` to align client boundaries and scheduled times with the medication's timezone.

### Care Circle Requests Not Appearing
- **Status**: OPEN (Pending Verification)
- **Problem**: Patient web client failed to create `PENDING` caregiver connection request rows because direct client-side inserts on `caregiver_connections` were blocked by Row-Level Security policies, causing requests to silently fail.
- **Remediation**: Replaced direct client inserts with calls to the `invite_caregiver` SECURITY DEFINER RPC.

### Unknown User Display in Request Lists
- **Status**: OPEN (Pending Verification)
- **Problem**: Names of pending requests resolved to "Unknown" because the SELECT policy on `profiles` relied on deprecated `caregiver_info` relationships and failed to resolve names for pending connection requests.
- **Remediation**: Updated `profiles` SELECT policy to allow users to read profiles of users with whom they have a connection (both `PENDING` and `ACCEPTED`) in `caregiver_connections`.


---

## 2. Technical Limitations & Sandbox Issues

### Direct Database TCP Traffic Blocked
- **Status**: ACTIVE LIMITATION
- **Details**: Direct PostgreSQL TCP traffic (ports 5432 and 6543) is blocked from within the agent's sandbox by firewall rules. Programmatic migrations using `pg` node client fail.
- **Workaround**: SQL migrations must be run manually by the developer in the Supabase SQL editor dashboard.

---

## 3. Open Architecture Gaps (need a decision or infra)

These are documented deliberately because they cannot be resolved as a pure, behavior-preserving code change — each needs a product decision or a deploy/infra environment.

### Frequency Recurrence Is Not Honored by the Reminder Engine
- **Status**: RESOLVED (planner made truthful) — engine-level recurrence remains a future feature
- **Problem**: The bot scheduler's `calculateNextReminder` (`src/utils.js`) expands `reminder_times` **every day** and ignores `frequency`. So `every_other_day`/`weekly` medications actually fire **daily**. The web dashboard (daily) matched this; the Schedule Planner was the only surface that gated by frequency, so it displayed a recurrence the engine never follows.
- **Blast radius (small)**: The web "new/edit" forms only offer `once/twice/thrice_daily` (see `medication-form-options.tsx`), so `every_other_day`/`weekly` can only originate from the Telegram bot or legacy rows.
- **Fix applied**: `getMedicationsForDate` in `web/.../schedule-planner/page.tsx` no longer gates by frequency — it shows a dose on every day, matching what the engine actually fires. The now-single-use `isDoseScheduledOnDate` helper was removed from `dose-engine.ts`. The planner is now consistent with both the dashboard and the engine.
- **Future feature (not a bug)**: if real `every_other_day`/`weekly` behavior is wanted, teach `calculateNextReminder` to skip off-days; that changes *when doses fire* and needs its own tests across the bot.

### Minute-Tick Scheduler Single Point of Failure
- **Status**: PARTIALLY MITIGATED (failover route shipped; full send-failover pending infra)
- **Problem**: The every-minute reminder tick runs only inside the bot process on Render Free (`src/scheduler.js`). Render Free's ~750 instance-hours can exhaust near month-end and the service pauses → the loop stops until the 1st.
- **Shipped**: `web/src/app/api/cron/tick/route.ts` — an authenticated (`CRON_SECRET` Bearer) endpoint that runs the *idempotent DB-side* maintenance RPCs the bot already calls (`scan_and_escalate_overdue_reminders`, `close_daily_medications`). Inert until `CRON_SECRET` is set. Keeps escalation state and day-end closure (and therefore the web dashboard / review queue) advancing even while the bot host is paused. Introduces no new writer semantics — it calls the same SECURITY DEFINER RPCs.
- **Activation**: set `CRON_SECRET` in the web env, then add a Vercel Cron (or external cron) on `GET /api/cron/tick` every minute (Vercel Cron sends the Bearer header automatically).
- **Remaining (needs deploy verification)**: this route does **not** re-send the initial Telegram/browser-push reminder — that delivery still requires the bot process. Full send-failover means porting the message-send path (Telegram + web-push) into a shared module the route can call, then retiring the Render tick. Deferred because it can't be validated without a real Vercel deploy.

### Cross-Package Duplication of `calculateNextReminder`
- **Status**: OPEN (packaging change; needs deploy verification)
- **Problem**: `calculateNextReminder` exists in both `src/utils.js` (CJS, bot) and `web/src/lib/medication-utils.ts` (ESM, web). They are now algorithmically identical and tz-aware, but remain two physical copies that can drift again.
- **Constraint**: A true single source requires a shared workspace package or a source dir imported by both runtimes. The web app deploys from `web/` on Vercel (monorepo `directory: web`), so importing a module from outside `web/` risks breaking Vercel's file tracing/build. This must be validated against an actual Vercel build before adoption.
- **Mitigation in place**: both copies carry a comment requiring lockstep edits; the bot copy is covered by `test/utils.test.js`.
