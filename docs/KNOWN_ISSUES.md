# Re-MIND-eЯ — Known Issues

This document lists confirmed bugs, technical limitations, and security issues in the Re-MIND-eЯ application.

---

## 1. Active Issues (P0/P1)

### Timezone Mismatches on Virtual Events
- **Status**: Under Remediation (Sprint 5.7B Corrective)
- **Problem**: Client browser generates virtual events using the client's local browser timezone (e.g. UTC). This mismatch with the medication's database timezone (e.g. Asia/Kolkata) causes incorrect `scheduled_for` parameters, resulting in `INVALID_SCHEDULED_TIME` RPC failures.
- **Remediation**: Use `moment-timezone` to align client boundaries and scheduled times with the medication's timezone.

---

## 1a. Resolved (verified 2026-07-11)

The four Care Circle items formerly listed here as Active/P0-P1 were re-verified directly
against the live schema, RLS policies, and current web code and are confirmed fixed by the
`caregiver_connections` architecture superseding the legacy `caregiver_info` design:

- **Care Circle Overwrite & Limit Bug** — `caregiver_connections` carries
  `UNIQUE(caregiver_profile_id, patient_profile_id)` (a compound pair, not a
  single-caregiver-per-patient constraint), and `invite_caregiver()` inserts an independent row
  per pair. No overwrite path exists. `caregiver_info` remains in the web code only as a clearly
  labeled legacy fallback for pre-migration rows, not a live write path for new links.
- **Request Notifications RLS Failure** — `notifications` has zero direct client INSERT
  policies (blocks direct writes entirely); `trg_audit_and_notify_caregiver_changes`
  (SECURITY DEFINER, fires on `caregiver_connections` insert/update) creates the notification
  rows instead.
- **Care Circle Requests Not Appearing** — `settings-client-view.tsx` calls the
  `invite_caregiver` RPC (not a direct insert) for all new connection requests.
- **Unknown User Display in Request Lists** — the `profiles` SELECT policy covers any
  `is_active=true` `caregiver_connections` row regardless of `connection_status`
  (`PENDING` or `ACCEPTED`), so both states resolve a name.


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
- **Status**: RESOLVED (2026-07-11) — push-only send-failover shipped and verified live
- **Problem**: The every-minute reminder tick runs only inside the bot process on Render Free (`src/scheduler.js`). Render Free's ~750 instance-hours can exhaust near month-end and the service pauses → the loop stops until the 1st.
- **Design**: `docs/superpowers/specs/2026-07-11-reminder-send-failover-design.md`. Heartbeat takeover — the bot upserts `scheduler_heartbeat.last_beat` every tick; `web/src/app/api/cron/tick/route.ts` (pinged every minute by an external cron with a `CRON_SECRET` Bearer) is a total no-op while the beat is fresh, and takes over sending when it goes stale (>180s). Push-only by design: Telegram is unreachable when the bot is down anyway, since Telegram delivery and the Take/Skip callback handling both live in the same paused bot process.
- **Exactly-once**: enforced by the shared `minute_tick` advisory lock plus the `reminder_events` `UNIQUE(medication_id, scheduled_for)` and `push_logs` `UNIQUE(event_id, 'SENT')` constraints — verified with a live acceptance test (bot suspended, one push delivered, zero duplicate `SENT` rows, dose resolved via the always-up push routes, bot resumed, route returned to dormant).
- **Found + fixed during activation**: `SUPABASE_SERVICE_ROLE_KEY` was missing from the Vercel Production environment, silently 500ing every route that calls `createServiceClient()` (19 files, including account deletion and push-action tracking). Added and verified.

### Cross-Package Duplication of `calculateNextReminder`
- **Status**: OPEN (packaging change; needs deploy verification)
- **Problem**: `calculateNextReminder` exists in both `src/utils.js` (CJS, bot) and `web/src/lib/medication-utils.ts` (ESM, web). They are now algorithmically identical and tz-aware, but remain two physical copies that can drift again.
- **Constraint**: A true single source requires a shared workspace package or a source dir imported by both runtimes. The web app deploys from `web/` on Vercel (monorepo `directory: web`), so importing a module from outside `web/` risks breaking Vercel's file tracing/build. This must be validated against an actual Vercel build before adoption.
- **Mitigation in place**: both copies carry a comment requiring lockstep edits; the bot copy is covered by `test/utils.test.js`.
