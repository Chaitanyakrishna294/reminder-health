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
-- Idempotent; safe to re-run in the Supabase SQL Editor.
-- Companion files: db/rollbacks/rollback_retry_ladder_2026_08_14.sql,
--                  db/validations/validation_retry_ladder_2026_08_14.sql
-- Shared fixture: test/retry-ladder-vectors.json
-- ============================================================================

ALTER TABLE public.medications
  ADD COLUMN IF NOT EXISTS retry_interval_minutes SMALLINT,
  ADD COLUMN IF NOT EXISTS retry_count SMALLINT;

COMMENT ON COLUMN public.medications.retry_interval_minutes IS
  'Minutes between device retry rings for this medication. NULL = use the priority default (routine 15, important 10, critical 5). Overrides are offered for important and critical only.';

COMMENT ON COLUMN public.medications.retry_count IS
  'How many times the device re-asks before leaving the sticky missed notice. NULL = use the priority default (routine 1, important 2, critical 5). retry_interval_minutes * retry_count may not exceed 30 — see the CHECK below.';

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
    (retry_interval_minutes IS NULL AND retry_count IS NULL)
    OR (
      retry_interval_minutes IS NOT NULL
      AND retry_count IS NOT NULL
      AND retry_interval_minutes >= 1
      AND retry_count >= 1
      AND retry_interval_minutes * retry_count <= 30
    )
  );

-- NOT VALID is deliberately NOT used: there is no existing data to grandfather
-- (both columns are new and NULL everywhere), so the constraint can be trusted
-- immediately rather than being a promise about future rows only.
