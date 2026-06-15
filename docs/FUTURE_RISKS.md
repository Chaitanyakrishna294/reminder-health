# Future-Risk Review — Re-MIND-eЯ

> Independent read of the codebase (bot `src/`, web `web/src/`, `db/migrations/`, configs) on
> 2026-06-15, focused on things that are *safe today but will break later* — under deploy,
> scale, a non-IST user, or the next feature. This complements `problem.md` (the prior audit's
> 13 items); overlaps are noted. Citations are `path:line` — re-confirm before acting.

## Resolution status (2026-06-15)

Each item was re-verified against the actual code **and the live database** before acting —
several sub-claims turned out to be already-handled (noted below). No DB migration was needed
this round; all fixes are bot-code or tests.

| # | Status | What was done |
|---|--------|---------------|
| R1 | ✅ Mitigated | The blocking migration was **already applied to prod last session** (all 5 functions verified live), so the acute "silent no-op" risk is gone. Added a **boot-time self-check** (`verifySchedulerDependencies`, `src/scheduler.js`) that logs `FATAL` if the lock RPC is missing, keeping future "deploy code" and "apply migration" coupled. |
| R2 | ✅ Fixed | `calculateNextReminder(timesArray, timezone)` now interprets times in the medication's own tz (default IST). Threaded `med.timezone` at all `src/scheduler.js` callers; `src/commands.js` callers pass `state.timezone` (undefined → IST today, forward-compatible). |
| R3 | ⚠️ Decision needed | App is **single-instance today** (Telegram long-polling + in-memory `userStates`/`activeSnoozes`). The cron lock is kept as cheap protection against deploy-overlap double-fires, **not** an endorsement of multi-instance. Scaling requires webhooks + externalized conversation state first — see note below. Not changed unilaterally. |
| R4 | ✅ Low active risk | Verified: the low-stock read (`src/scheduler.js:637`) already skips null `tablet_count`, and the one-way sync trigger keeps `tablet_count = floor(current_stock)` on every write (writes only ever touch `current_stock`). No active drift. Collapsing to one column remains recommended **planned debt**. |
| R5 | ✅ Non-issue (race) | `caregiver_info.caregiver_id` **already has a UNIQUE index** (`caregiver_info_caregiver_id_key`, confirmed live), so the CG-ID check-then-insert cannot create duplicates. Full legacy-table retirement remains planned debt. |
| R6 | ✅ Fixed | Added `test/utils.test.js` (Node built-in `node:test`, no new deps) covering `calculateNextReminder` timezone behavior + `isValidTime`; `npm test` wired and scoped to `test/` (excludes `scratch/`). 6 tests passing. |
| R7 | ⚠️ Recommendation | No code fix; recommend adopting Supabase CLI migrations or a `schema_migrations` ledger. Tracked as planned debt. |
| R8 | ✅ Fixed | Weekly-summary cron now passes `{ timezone: "Asia/Kolkata" }` (`src/scheduler.js`), matching the other four crons. |
| R9 | ✅ Mostly non-issue | push-log "(null,status) collision" does **not** occur — Postgres treats NULLs as distinct in the `(event_id,status)` unique index (verified). `lucide-react`/dep-pinning and the `commands.js:1513` fire-and-forget are minor planned debt. |

**R3 note (the one real fork):** to run more than one instance you must (a) switch Telegram from
`polling: true` (`src/bot.js:16`) to webhooks — only one poller per token is allowed, else HTTP 409s —
and (b) move `userStates`/`activeSnoozes` out of process memory (DB/Redis). Until then, deploy
exactly one instance. This is a product/infra decision, deliberately left to you.

---

## Severity at a glance

| # | Risk | Trigger that makes it bite | Severity |
|---|------|----------------------------|----------|
| R1 | Scheduler requires an un-applied migration | Deploying current `src/scheduler.js` before running `migration_arch_hardening_2026_06.sql` | 🔴 Critical |
| R2 | Hard-coded `Asia/Kolkata` in reminder math | First user in any other timezone | 🔴 Critical |
| R3 | In-memory state + Telegram long-polling block multi-instance | Running 2 instances / horizontal scale | 🔴 High |
| R4 | Dual stock columns (`current_stock` vs `tablet_count`) | Any edit path that touches one and not the other | 🟠 High |
| R5 | Legacy `caregiver_info` still live alongside `caregiver_connections` | Continued dual-model writes | 🟠 Medium |
| R6 | No automated tests on a health-critical flow | Every future change | 🟠 Medium |
| R7 | Manual, unordered migration process | Schema drift between repo and prod | 🟠 Medium |
| R8 | Weekly-summary cron runs in server TZ, not IST | Server not in IST (Vercel/Render = UTC) | 🟡 Low |
| R9 | Smaller latent issues (CG-ID loop, push-log conflict key, `^` dep ranges) | Various | 🟡 Low |

---

## R1 — The scheduler depends on a migration that hasn't been run 🔴

This is the highest-priority item because it can silently stop *all* reminders.

The current `src/scheduler.js` opens every minute-tick by calling
`supabase.rpc('try_acquire_scheduler_lock', …)` and bails out of the whole tick if that call
errors:

```
if (lockAcquireErr) {
  console.error('[Scheduler] Failed to acquire minute-tick lock; skipping tick:', …);
  return;            // ← skips the entire reminder loop
}
```
(`src/scheduler.js:132-144`, release at `:532`).

Those two functions (`try_acquire_scheduler_lock`, `release_scheduler_lock`) are defined **only**
in `db/migrations/migration_arch_hardening_2026_06.sql`, and `problem.md` states that migration is
"not yet run against production." So if this commit is deployed before the SQL is applied, the RPC
errors on every tick, the scheduler returns early, and **no medication reminders, escalations,
snooze-wakes, or daily closes fire at all** — with only a log line to show for it.

The same migration also backs B1 (`close_daily_medications` TZ fix), B5 (link-code cleanup) and
B7 (stock). Treat "apply the migration" and "deploy the code" as a single coupled release, and add
a startup self-check that pings the RPC once and refuses to start (loudly) if it's missing, rather
than degrading to a silent no-op every minute.

## R2 — Reminder time math is hard-wired to `Asia/Kolkata` 🔴

`medications.timezone` exists and the SQL RPCs already honour it
(`coalesce(nullif(m.timezone,''),'Asia/Kolkata')`), but the **JavaScript** that actually computes
when the next dose fires ignores it completely:

- `calculateNextReminder()` builds every candidate with `moment().tz('Asia/Kolkata')`
  (`src/utils.js:24-62`) — the medication's own timezone is never read.
- All display/formatting in the bot is IST too (`src/commands.js:25,245,420,436,891,1127`;
  `src/scheduler.js:184,409-411`).

Today every user is IST so it works. The moment one medication is set to, say,
`America/New_York`, its `next_reminder_at` is computed on the IST clock and it fires ~10.5 hours
off. `problem.md` B1/B3 touch the SQL side of this; the **`src/utils.js` driver is the root** and
isn't covered there. Fix: pass each medication's `timezone` into `calculateNextReminder` and the
formatters, defaulting to IST only when unset.

## R3 — In-memory state and long-polling make the app single-instance, but the new lock implies multi-instance 🔴

There's a contradiction in the architecture's direction. R1's cross-instance lock exists precisely
so two overlapping instances can't double-process — i.e. someone intends to run more than one
instance. But two other things break the moment a second instance exists:

1. **Telegram long-polling.** `new TelegramBot(token, { polling: true })` (`src/bot.js:16`). Telegram
   allows exactly one `getUpdates` poller per token; a second instance gets HTTP 409 conflicts and
   updates get split/dropped. The DB lock guards the cron tick, not polling.
2. **Module-level in-memory state.** `userStates` (`src/commands.js:7`) and `activeSnoozes`
   (`src/utils.js:81`) live in process memory. A second instance has its own copy, and **any**
   restart wipes a user's mid-conversation "add medication" flow and snooze counters. Snooze limits
   re-check the DB so they're safe, but multi-step flows silently reset.

Pick a lane: either commit to single-instance (and drop/justify the lock), or move to webhooks +
externalize conversation state (DB/Redis) before scaling. Running two instances of the code as-is
will produce 409 storms and lost flows.

## R4 — Two stock columns that can disagree 🟠

Stock is split across `current_stock` (NUMERIC) and `tablet_count` (INTEGER), kept in sync by a
**one-way** trigger `current_stock → tablet_count`
(`db/migrations/migration_medication_enhancements.sql:8,17-25`). The code reads and writes both
inconsistently:

- Add / refill / edit-stock write `current_stock` (`src/commands.js:925,1118,857`).
- Low-stock alerts and the caregiver panel read `tablet_count`
  (`src/scheduler.js:637-639,822-824`; `src/commands.js:248`).

So correctness depends entirely on that trigger being present in prod (another reason R7/R1 matter).
The sync is one-directional: anything that sets `tablet_count` directly won't flow back to
`current_stock`, and the decrement logic operates on `current_stock` — so the two can drift, and a
drifted/null `tablet_count` makes the caregiver panel compute `Math.floor(null / perDay)` and
report a false "0 days remaining / LOW STOCK." Collapse to one source of truth, or make the trigger
bidirectional and add a check constraint.

## R5 — Legacy `caregiver_info` is still in live paths 🟠

`KNOWN_ISSUES.md` and `CURRENT_SYSTEM_STATE.md` declare `caregiver_connections` the single source of
truth, but `caregiver_info` is still actively read/written: caregiver registration and ID lookup
(`src/commands.js:113-118,687-698,1007-1039,1053-1057`). The relationship was moved, but the
caregiver *identity/ID* still lives in the legacy table, so the system runs on two half-models. This
is the same dual-model seam that produced the original "overwrite / second caregiver" bug class.
Until `caregiver_info` is either fully retired or clearly scoped to "identity only," expect
recurring edge cases here. Also note `CG`-ID generation loops `while (!isUnique)` doing a SELECT per
attempt with no unique constraint shown (`:1021-1032`) — a check-then-insert race.

## R6 — No automated tests on a safety-critical path 🟠

`package.json` `test` is the default `exit 1`; there's no test runner anywhere. For an app whose
core job is firing medication reminders and caregiver escalations, the absence of even a handful of
unit tests around `calculateNextReminder`, the snooze/escalation state machine, and stock math means
every refactor is unguarded. The `scratch/` directory has ~60 ad-hoc probe scripts standing in for a
real suite. Add unit tests for the pure logic first (timezone math, streak calc, next-reminder), then
integration tests against a Supabase test project.

## R7 — Migrations are applied by hand, unordered 🟠

`KNOWN_ISSUES.md` notes direct Postgres TCP is firewalled in the build sandbox, so all ~40
migrations are pasted into the Supabase SQL editor manually. There's no migration runner, no applied
ledger, and filenames aren't strictly ordered, so prod schema state is only knowable by inspection.
R1 is the acute symptom of this. Adopt a tracked migration tool (Supabase CLI migrations) or at
minimum a `schema_migrations` ledger table and a documented apply order, so "is this function live?"
has a definitive answer.

## R8 — One cron uses server time instead of IST 🟡

Four of the five crons pin `timezone: "Asia/Kolkata"`, but the weekly-summary cron does not:
`cron.schedule('0 20 * * 0', …)` with no options (`src/scheduler.js:544`). On a UTC host (Vercel /
Render default) that fires at 20:00 UTC ≈ 01:30 IST Monday, not Sunday 8 PM as intended. Add the
`{ timezone: "Asia/Kolkata" }` option for consistency.

## R9 — Smaller latent items 🟡

- **Push-log conflict key.** `push_logs` upserts with `onConflict: 'event_id,status'` and
  `ignoreDuplicates` (`src/scheduler.js:89-94,107-113`). For non-reminder pushes `event_id` is null,
  so different users' rows collide on the same `(null, status)` key and get dropped — observability
  loss, not a functional bug.
- **Fire-and-forget compatibility update.** The post-resolve "clear old scheduling columns" write
  isn't result-checked (`src/commands.js:1513-1520`) — low impact but the same pattern R1's B3 fix
  warns about.
- **Dependency ranges.** Everything is `^`-ranged (`package.json`). `lucide-react: ^1.17.0` in
  `web/package.json` looks off for a library that publishes on `0.x`; worth verifying it resolves to
  the intended version. Next 16 / React 19 are fine but pin them for reproducible prod builds.
- **`sharp` in the bot's deps** appears only used by a `scratch/` icon-resizer — a heavy native dep
  to carry in the runtime image if it's not used in `src/`.

---

## Suggested order

1. **R1 first, today** — couple the migration to the deploy (or it silently kills reminders).
2. **R2 + R4** — they corrupt the core function (when doses fire; stock accuracy) the moment data
   varies from the IST/happy-path assumption.
3. **R3** — decide single- vs multi-instance before any scaling work.
4. **R6 + R7** — the process gaps that let R1-class problems recur.
5. **R5, R8, R9** — cleanups, bundle opportunistically.

---

## Web-app security pass (2026-06-15)

A separate audit swept `web/`. Verified findings were fixed; the scary headline items were
false alarms (documented so they aren't "re-fixed"):

**Fixed:**
- 🔴 **Stored XSS** — `dangerouslySetInnerHTML` injecting `caregiver_name` is now rendered as JSX
  (`web/src/app/(dashboard)/care-circle/manage/page.tsx`).
- 🟠 **Security headers** — `web/next.config.ts` now serves CSP (`frame-ancestors 'none'`),
  `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, HSTS, `Permissions-Policy` (verified live).
- 🟠 **Open redirect** — auth callback `?next=` is sanitized to internal paths only
  (`web/src/app/api/auth/callback/route.ts`).
- 🟡 **`noopener`** added to the one external `target="_blank"` link (`caregiver-console.tsx`).
- 🟡 **`tel:` URI** — phone stripped to `[\d+]` before navigation (`dashboard-main-layout.tsx`).

**Verified already-safe (no change):**
- Push-tracking callbacks bind the body `eventId` to the bearer token (`acknowledge/route.ts:34`) —
  capability auth, not an IDOR.
- `SUPABASE_SERVICE_ROLE_KEY` lives only in gitignored `web/.env.local`; **never committed**, absent
  from tracked source/history. Used solely server-side. Rotation optional hygiene.
- Cookies (Supabase SSR: httpOnly+secure+sameSite), CORS (same-origin default), and client-side
  permission UI (server/RLS-enforced) all pass.

**Residual / planned debt:**
- **npm audit (moderate):** `postcss < 8.5.10` XSS (GHSA-qx2v-qp2m-jg93) pulled transitively via
  `next@16.2.7`. Build-time CSS-stringify issue, not a runtime vector here. Only `npm audit fix
  --force` resolves it — it downgrades Next to 9.3.3 (unacceptable). Hold for an in-major Next patch.
- **CSP** intentionally allows `'unsafe-inline'`/`'unsafe-eval'` on `script-src` so Next's inline
  runtime isn't broken; nonce-based hardening is future work.
