-- Retry ladder configuration (2026-08-14).
--
-- Between the first ring and the caregiver being told, the honest thing to do is
-- ask again — someone put the phone down, or was in the shower. These two
-- columns are how a critical medication says "ask me every 3 minutes" instead of
-- taking the default five-by-five.
--
-- NULL MEANS "USE THE PRIORITY DEFAULT", and that is the normal state. Backfill
-- would be wrong here: writing 5/5 onto every critical row today would freeze
-- the defaults into the data, so improving them later would reach only
-- medications added after the change. The defaults live in
-- web/src/lib/schedule/retry-ladder.ts and the Kotlin port of it; the columns
-- exist only to override them.
--
-- THE CAP IS 30 MINUTES on `interval * count`, and it is a safety property, not
-- a preference. `scan_and_escalate_overdue_reminders` clamps its escalation
-- anchor to `created_at + 30 minutes` so that a dose nobody re-prompted still
-- escalates. If a ladder could run past that clamp, the device would be politely
-- re-asking the patient at +35 while the caregiver was already being told the
-- dose was missed — the app contradicting itself across two phones. Capping here
-- means the scheduler's most-feared function is never edited to accommodate this
-- feature.
--
-- The CHECK enforces the cap in the one place a direct API write cannot skip.
-- The form validates too, but a form check is advice — the same reasoning as the
-- Health Vault upload limits.
--
-- ⚠ CORRECTED 2026-08-14 AFTER A FAILED APPLY. The first version of this file
-- named its columns `retry_interval_minutes` / `retry_count`, and the second of
-- those ALREADY EXISTS on `medications` — it is a pre-repo column from the
-- original bot table (`00_baseline_pre_repo_tables.sql`: `retry_count INTEGER
-- DEFAULT 0`), and `src/scheduler.js` still WRITES it on every reschedule.
--
-- So `ADD COLUMN IF NOT EXISTS retry_count` was a silent no-op, every row
-- already held `retry_count = 0` with a NULL interval, and the CHECK read that
-- as a half-configured ladder:
--
--   ERROR: 23514: check constraint "medications_retry_ladder_within_cap"
--          of relation "medications" is violated by some row
--
-- Violated by EVERY row, in fact. The failure was loud and immediate, which is
-- the good outcome — the bad one would have been the constraint landing and the
-- bot's own `retry_count: 0` writes starting to fail at 3am.
--
-- Both columns are renamed to `retry_ladder_*`. The bot's `retry_count` is left
-- completely alone; nothing in this file reads or writes it.
--
-- Idempotent; safe to re-run in the Supabase SQL Editor.
-- Companion files: db/rollbacks/rollback_retry_ladder_2026_08_14.sql,
--                  db/validations/validation_retry_ladder_2026_08_14.sql
-- Shared fixture: test/retry-ladder-vectors.json
-- ============================================================================

-- Clean up the half-applied first attempt. `retry_interval_minutes` was this
-- feature's own new column, so dropping it is safe; if the failed run never
-- created it, this is a no-op. `retry_count` is NOT dropped — it is the bot's.
ALTER TABLE public.medications
  DROP COLUMN IF EXISTS retry_interval_minutes;

ALTER TABLE public.medications
  ADD COLUMN IF NOT EXISTS retry_ladder_interval_minutes SMALLINT,
  ADD COLUMN IF NOT EXISTS retry_ladder_count SMALLINT;

COMMENT ON COLUMN public.medications.retry_ladder_interval_minutes IS
  'Minutes between device retry rings for this medication. NULL = use the priority default (routine 15, important 10, critical 5). Overrides are offered for important and critical only.';

COMMENT ON COLUMN public.medications.retry_ladder_count IS
  'How many times the device re-asks before leaving the sticky missed notice. NULL = use the priority default (routine 1, important 2, critical 5). retry_ladder_interval_minutes * retry_ladder_count may not exceed 30. NOT to be confused with medications.retry_count, which is the bot''s own send-retry counter and is untouched by this feature — see the CHECK below.';

-- Both-or-neither, in range, and under the cap.
--
-- Written as ONE constraint rather than three so the failure names the actual
-- rule. A half-configured row (interval set, count NULL) is rejected rather than
-- silently half-defaulted: "every 3 minutes, some number of times" is not a
-- schedule anyone chose.
ALTER TABLE public.medications
  DROP CONSTRAINT IF EXISTS medications_retry_ladder_within_cap;

ALTER TABLE public.medications
  ADD CONSTRAINT medications_retry_ladder_within_cap CHECK (
    (retry_ladder_interval_minutes IS NULL AND retry_ladder_count IS NULL)
    OR (
      retry_ladder_interval_minutes IS NOT NULL
      AND retry_ladder_count IS NOT NULL
      AND retry_ladder_interval_minutes >= 1
      AND retry_ladder_count >= 1
      AND retry_ladder_interval_minutes * retry_ladder_count <= 30
    )
  );

-- NOT VALID is deliberately NOT used: both columns really are new now and NULL
-- everywhere, so the constraint can be trusted immediately rather than being a
-- promise about future rows only. That claim was WRONG in the first version of
-- this file — which is exactly what the failed apply proved, and the reason the
-- ADD CONSTRAINT is worth running eagerly rather than deferring validation.
