-- Non-daily schedules (2026-08-10) — let a medication be due on only SOME days
-- of the week ("twice a week", "Mon/Wed/Fri"), instead of every single day.
--
-- Gap being closed (this is a MISSING FEATURE, not a live defect):
--   medications.frequency has only ever held once_daily | twice_daily |
--   thrice_daily (see 00_baseline_pre_repo_tables.sql L23). All three describe
--   how many times PER DAY a dose is taken, and that count is already carried by
--   the length of reminder_times. So there is currently NO way to express a
--   weekly cadence at all, and both reminder engines correctly expand
--   reminder_times every day for every row that can exist today.
--   Real prescriptions routinely say "thrice a week" (methotrexate, many
--   supplements, alternate-day steroids) and those patients presently get a
--   reminder every day — the app tells them to take a dose they should not take.
--
-- Model: DAY-OF-WEEK SET, not "every N days".
--   dose_days holds 0=Sunday .. 6=Saturday, matching both moment().day() and
--   JavaScript Date#getDay() so neither engine has to remap.
--   Chosen over an interval_days ("every 2 days") column because:
--     1. It is how prescriptions are actually written and how patients remember
--        them ("Monday, Wednesday, Friday" — not "every 2.33 days").
--     2. It is STATELESS. Whether a dose falls on a date is a pure function of
--        that date. An interval needs an anchor date and drifts if the anchor is
--        ever edited, the medication is paused, or a dose is skipped.
--     3. The Schedule Planner projects BOTH backwards and forwards over an
--        arbitrary month grid (web/src/lib/schedule/day-doses.ts). Day-of-week
--        answers any date in O(1); an interval would need the anchor replayed.
--   Alternate-day dosing is the one real cadence this cannot express exactly
--   (it is not weekly-periodic). Those patients are served today by picking the
--   days they actually take it; a true interval_days column can be added later
--   without disturbing this one.
--
-- NULL = every day. This is the whole backward-compatibility story: every
-- existing row stays NULL, both engines treat NULL as daily, and behavior is
-- byte-identical to today until a user explicitly picks days. NO BACKFILL —
-- writing ARRAY[0,1,2,3,4,5,6] into every row would mean exactly the same thing
-- as NULL while holding this migration's ACCESS EXCLUSIVE lock for a full table
-- rewrite.
--
-- Deploy ordering — APPLY THIS FIRST, then deploy code:
--   * Migration applied, old code still deployed: nothing reads or writes the
--     column. Every medication keeps firing daily. Completely inert.
--   * New code deployed, migration NOT applied: reads degrade safely
--     (med.dose_days is undefined -> treated as daily -> today's behavior), but
--     the medication ADD/EDIT forms name dose_days in their INSERT/UPDATE and
--     PostgREST will reject those writes with PGRST204 until the column exists.
--     Saving a medication would break. Hence: apply first.
--
-- Idempotent; safe to re-run in the Supabase SQL Editor.
-- Companion files: db/rollbacks/rollback_dose_days_2026_08_10.sql,
--                  db/validations/validation_dose_days_2026_08_10.sql

BEGIN;

-- ============================================================================
-- 1. THE COLUMN
-- ============================================================================
ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS dose_days SMALLINT[];

COMMENT ON COLUMN public.medications.dose_days IS
  'Days of the week this medication is due, 0=Sunday .. 6=Saturday (matches moment().day() and JS Date#getDay(), so neither reminder engine remaps). NULL means EVERY DAY and is the default for every pre-existing row — do not backfill it to {0,1,2,3,4,5,6}, which means the same thing. reminder_times still carries how many doses fall on each due day; this column only decides WHICH days are due at all. Read by calculateNextReminder in src/utils.js (bot) and web/src/lib/medication-utils.ts (web), and by occursOn in web/src/lib/schedule/dose-engine.ts (dashboard + Schedule Planner projections). The CHECK below forbids an empty array: {} would mean a medication that is never due, which is a footgun, not a schedule — use NULL for daily or deactivate the row instead.';

-- ============================================================================
-- 2. VALIDITY CONSTRAINT
-- ----------------------------------------------------------------------------
-- Bounds + non-empty only. Duplicate entries ({1,1,3}) are deliberately NOT
-- rejected: a CHECK constraint cannot contain a subquery, so de-duplication
-- would need an immutable helper function, and duplicates are harmless anyway —
-- every consumer asks "is today's weekday in this set?", which is unaffected by
-- repeats. The forms write a sorted unique set regardless.
--
-- Wrapped in a DO block because ALTER TABLE ... ADD CONSTRAINT has no
-- IF NOT EXISTS form, and this file must stay re-runnable.
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'medications_dose_days_valid'
      AND conrelid = 'public.medications'::regclass
  ) THEN
    ALTER TABLE public.medications
      ADD CONSTRAINT medications_dose_days_valid CHECK (
        dose_days IS NULL
        OR (
          cardinality(dose_days) BETWEEN 1 AND 7
          AND dose_days <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]
        )
      );
  END IF;
END;
$$;

-- ============================================================================
-- 3. NO INDEX — deliberately
-- ----------------------------------------------------------------------------
-- The minute-tick due-scan filters on (active, next_reminder_at, last_sent_at)
-- and never on dose_days: the weekday rule is applied when ADVANCING
-- next_reminder_at, so a row that is not due tomorrow simply gets a
-- next_reminder_at further out and never enters the scan. Nothing queries by
-- this column, so an index would be pure write cost.
-- ============================================================================

-- Tell PostgREST to reload its schema cache immediately, so the medication
-- forms can write dose_days without waiting out the cache (otherwise those
-- INSERT/UPDATEs get PGRST204 for up to ~10 minutes after this runs).
NOTIFY pgrst, 'reload schema';

COMMIT;
