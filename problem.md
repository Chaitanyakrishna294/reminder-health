# Architectural Issues — Verified Triage

> An external audit flagged 13 "architectural cracks." Each claim below was checked against
> the **actual code** before being recorded. About half were already mitigated — those are
> listed in **Section A** so nobody burns time re-fixing solved problems. The genuinely open
> issues are in **Section B**, ranked, with how to resolve and what to initiate first.
>
> Citations are `path:line` against the repo at the time of writing — re-confirm before acting.

## Resolution status (2026-06-15)

All real open issues have been resolved in code. DB changes are bundled into one idempotent
migration: **`db/migrations/migration_arch_hardening_2026_06.sql`** (apply via the Supabase
SQL Editor — not yet run against production).

| Item | Status | Where the fix lives |
|------|--------|---------------------|
| B1 close_daily TZ mismatch | ✅ Fixed | `migration_arch_hardening_2026_06.sql` (B1 section) |
| B2 scheduler cross-instance lock | ✅ Fixed | migration (lease lock objects) + `src/scheduler.js` (acquire/release) |
| B3 next_reminder_at fire-and-forget | ✅ Fixed | `src/scheduler.js` (checks update result, logs CRITICAL on failure) |
| B4 caregiver_info RLS leak | ✅ Already handled | `migration_security_fix_rls.sql` (live in prod; see Section A) |
| B5 link_codes cleanup cron | ✅ Fixed | `migration_arch_hardening_2026_06.sql` (B5 section) |
| B6 preview signed-URL expiry | ✅ Fixed | `web/.../health-vault-client-view.tsx` (auto re-sign effect) |
| B7 stock compensating increment | ✅ Fixed | `migration_arch_hardening_2026_06.sql` (B7 section) |

**Verification done:** all four SQL functions were compiled against the live schema inside a
rolled-back transaction (nothing persisted); the lease lock was exercised (first acquire
`true`, concurrent acquire `false`); `src/scheduler.js` passes `node --check`. To activate the
DB fixes, run the migration in the Supabase SQL Editor.

---

## Section A — Already handled (verified safe, do NOT re-fix)

These were flagged as bugs but the protection already exists in code. Keep this list so they
don't get re-opened.

| # | Audit claim | Why it's already safe | Evidence |
|---|-------------|-----------------------|----------|
| A1 | "No dedup guard at RPC level for virtual dose → real event" | `resolve_reminder_event` takes `pg_advisory_xact_lock(hashtextextended(...))`, then `SELECT ... FOR UPDATE` on `(medication_id, scheduled_for)`, backed by a `UNIQUE (medication_id, scheduled_for)` constraint. The RPC updates the existing real event instead of duplicating. | `db/migrations/migration_5.7b_escalation_outcomes_ddl.sql:414-431`, `db/migrations/migration.sql:77` |
| A2 | "Concurrent primary caregiver assignment — needs a UNIQUE partial index" | The index already exists: `idx_single_active_primary_caregiver` UNIQUE on `(patient_profile_id) WHERE is_primary = true AND is_active = true AND connection_status = 'ACCEPTED'`. The second concurrent commit fails the constraint. | `db/migrations/migration_caregiver_decoupling_phase_a.sql:39-41` |
| A3 | "Stale push subscriptions never cleaned up (HTTP 410)" | `sendBrowserPush` catches `statusCode === 410 || 404` and deletes the `push_subscriptions` row immediately; other codes are logged, not swallowed. | `src/scheduler.js:94-100` |
| A4 | "GUC-based trigger bypass is fragile across rollback" | The bypass GUC `app.cc_internal` is set with `set_config(..., true)` — **transaction-local**, so it resets at txn end/rollback automatically. Never set session-level. | `db/migrations/migration_carecircle_respond_rpc.sql:88,100` |
| A5 | "reminder_logs vs reminder_events can drift" | Both tables are written inside the **same** `resolve_reminder_event` transaction (the event UPDATE and the log UPSERT). If one rolls back, both do. No async/independent trigger. | `db/migrations/migration_5.7b_escalation_outcomes_ddl.sql:519-565` |

---

## Section B — Real open issues (ranked)

### 🔴 B1 — `close_daily_medications` timezone mismatch
**Symptom:** The day-end closer groups doses by each medication's own timezone, but then
filters with a **hardcoded** `Asia/Kolkata` date. For any non-IST medication, the GROUP BY
date and the WHERE date disagree, so some `PENDING_REVIEW`/`ESCALATED` doses never close on
the correct local day (closed a day early/late, or skipped).

**Evidence:** `db/migrations/migration_5.7b_escalation_outcomes_logic.sql`
- `:186` — CTE groups by `(re.scheduled_for AT TIME ZONE coalesce(nullif(m.timezone,''),'Asia/Kolkata'))::date`
- `:196` — WHERE compares `(re.scheduled_for AT TIME ZONE 'Asia/Kolkata')::date = db.scheduled_date` ← hardcoded TZ

**Resolution:** Make the WHERE clause use the same per-medication TZ expression as the CTE, or
join the row back to the CTE on `medication_id` so `scheduled_date` is reused rather than
recomputed against a fixed zone. Keep the `+ 2 hours` grace window.

**Initiate first:** SQL repro — insert a medication with `timezone='America/New_York'` and a
late-evening dose, advance `now()`, assert the dose transitions to `UNCONFIRMED` on the
correct NY local day, not the IST day.

---

### 🔴 B2 — Scheduler has no cross-instance lock
**Symptom:** The cron runs every minute with no distributed lock. On a deploy/restart where
two instances overlap, both run the same tick. Sends are guarded by an optimistic
`last_sent_at` compare-and-set, but `scan_and_escalate_overdue_reminders` has **no**
idempotency guard, so the same overdue reminder can escalate twice → duplicate caregiver
alerts.

**Evidence:** `src/scheduler.js`
- `:120` — `cron.schedule('* * * * *', ...)`
- `:185-201` — optimistic `last_sent_at` CAS (protects sends only)
- `:307` — `supabase.rpc('scan_and_escalate_overdue_reminders')` (no guard)

**Resolution:** Wrap each tick in a Postgres session-level advisory lock —
`pg_try_advisory_lock(<constant key>)` at tick start, bail if not acquired, release in a
`finally`. This serializes ticks across instances without external infra. (Alternatively, add
an idempotency/`last_escalated_at` guard inside the scan RPC.)

**Initiate first:** Run two local instances against staging within the same minute; confirm
exactly one tick proceeds and no duplicate escalation rows/alerts are produced.

---

### 🟠 B3 — `next_reminder_at` update is fire-and-forget
**Symptom:** After sending, the scheduler updates `next_reminder_at` without checking the
result. A silent failure leaves the field stale — the medication either re-fires forever or
its next dose is skipped.

**Evidence:** `src/scheduler.js:263-276` (update with no error/rowcount check). Note also
`src/utils.js:24-62` computes next reminder against a hardcoded `Asia/Kolkata` — related TZ
debt to revisit alongside B1.

**Resolution:** Check the update's `error`/affected-rows; log + retry on failure. Add a
watchdog query that flags medications whose `next_reminder_at` is implausibly far in the past
(stalled) for re-computation.

**Initiate first:** Inject an update failure (e.g., bad value / forced error), confirm it's
detected and logged rather than silently stalling the medication.

---

### ✅ B4 — `caregiver_info` RLS — ALREADY HANDLED (false alarm, verified against live DB)
**Original concern:** the `active_caregiver_links` view unions legacy `caregiver_info`, whose
SELECT policy in the *old* `setup_db.sql` / `migration.sql` was `USING (true)` — a potential
cross-tenant read leak for un-migrated links.

**Reality (verified live 2026-06-15):** a later committed migration already closed this; the
concern was based on a superseded file.
- `caregiver_info` SELECT/INSERT/UPDATE are scoped to
  `caregiver_chat_id = get_my_telegram_chat_id() OR patient_telegram_id = get_my_telegram_chat_id()`
  — `db/migrations/migration_security_fix_rls.sql:139-161` (confirmed present in live `pg_policies`).
- `active_caregiver_links` has `security_invoker = on` live, so that scoped RLS applies to the
  calling user through the view.

**Action:** none — closed.

---

### 🟡 B5 — `link_codes` has no cleanup job
**Symptom:** `link_codes` has a 15-minute TTL column but no cleanup — unredeemed codes
accumulate indefinitely. Every other ephemeral table (trash, stale connection requests) has a
`pg_cron` cleanup; this one is the gap.

**Evidence:** `db/migrations/setup_db.sql:18-27` (table + `expires_at`, no job). Pattern to
copy: `cleanup_expired_trash()` + daily cron in
`db/migrations/migration_health_vault_stabilization.sql:14-60`.

**Resolution:** Add `cleanup_expired_link_codes()` deleting `WHERE expires_at < now()`, plus a
daily `pg_cron` schedule, mirroring the trash cleanup job.

**Initiate first:** Seed expired + fresh codes, run the function, assert only expired rows are
deleted.

---

### 🟡 B6 — Health Vault PDF preview signed-URL expiry
**Symptom:** Preview signs a URL with a 10-minute TTL and never refreshes it. A user reading a
large PDF past 10 minutes gets a silent `403`/blank — no refresh or error handling.

**Evidence:** `web/src/app/(dashboard)/health-vault/health-vault-client-view.tsx`
- `:266` — `createSignedUrl(path, 600, { download: false })` (preview, 10 min)
- `:1557-1713` — preview modal renders the URL in `<object>`/`<img>`/`<iframe>` with no error/refresh handler
- (For contrast, download re-signs per action at `:224`, `:228` — the safe pattern.)

**Resolution:** Add an error handler / "Refresh preview" action that re-signs on expiry (or
re-sign on a timer), or extend the preview TTL. Re-signing per interaction is the cleaner fix.

**Initiate first:** Open a preview, let the URL expire, confirm graceful re-sign instead of a
silent failure.

---

### 🔵 B7 — Stock has no compensating increment (latent)
**Symptom:** `handle_reminder_event_taken_stock_reduction` is correctly idempotent on the
`→ TAKEN` transition (won't double-decrement), but there is **no** compensating increment if a
dose is ever reverted away from `TAKEN`. No "reopen" feature exists today, so this is latent —
but it becomes a real inventory bug the moment such a transition is introduced.

**Evidence:** `db/migrations/migration_medication_enhancements.sql:38-63` (decrement on
`OLD IS DISTINCT FROM 'TAKEN' AND NEW = 'TAKEN'`; no reverse path).

**Resolution:** When/if a reopen or status-correction path is added, extend the trigger to
increment stock on a `TAKEN → non-TAKEN` transition, keeping decrement and increment symmetric.

**Initiate first:** Defer until a reopen feature is planned; add the symmetric trigger logic as
part of that work.

---

## Section C — Suggested execution order

1. **Repro the two 🔴 items first** (B1, B2) — they misfire **silently in production** today
   (wrong-day closures; duplicate escalations on deploy).
2. **Then the 🟠 data-integrity items** (B3 stalled scheduling, B4 RLS read leak — B4 is a
   privacy issue, prioritize if un-migrated `caregiver_info` rows still exist).
3. **Then 🟡** (B5 cleanup cron, B6 preview refresh).
4. **B7** is latent — bundle with any future dose-reopen work.

**Change surface per item:**

| Item | Migration (DB) | Bot code (`src/`) | Web (`web/src/`) |
|------|:--:|:--:|:--:|
| B1 close_daily TZ | ✅ | | |
| B2 scheduler lock | maybe (RPC guard) | ✅ | |
| B3 next_reminder_at | | ✅ | |
| B4 caregiver_info RLS | ✅ | | |
| B5 link_codes cron | ✅ | | |
| B6 preview signed URL | | | ✅ |
| B7 stock compensation | ✅ | | |
