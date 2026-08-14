-- Rollback for migration_notification_targets_2026_08_14.sql
--
-- Restores `handle_reminder_event_state_change` to the definition in
-- migration_carecircle_rca_fixes.sql, then drops the two columns.
--
-- ORDER MATTERS: the trigger must stop writing the columns before they can be
-- dropped, or every dose resolution fails until it does.
--
-- THIS DESTROYS DATA, unlike most rollbacks in this directory. Dropping the
-- columns discards the dose identity recorded on every notification written
-- since the migration, and re-applying cannot recover it — those rows fall back
-- to the created_at approximation permanently. If the goal is only to stop the
-- client navigating, change the client: it treats a NULL medication_id as
-- "approximate" already, so leaving the columns in place costs nothing.
--
-- Run section 1 alone if you want the trigger reverted but the data kept.
-- ============================================================================

-- ── 1. Trigger back to the pre-2026-08-14 body ──────────────────────────────
-- CREATE OR REPLACE, never DROP+CREATE: a DROP resets EXECUTE to PUBLIC.
-- Re-run the ENTIRE `handle_reminder_event_state_change` definition from
-- db/migrations/migration_carecircle_rca_fixes.sql (section 3) here.
--
-- Deliberately not duplicated into this file. A second hand-maintained copy of a
-- 200-line function that fans out to every caregiver is exactly the thing that
-- drifts, and a rollback running a stale body is worse than no rollback — it
-- would look like it worked. Copy from the source of truth at the moment you
-- need it.
\echo 'Paste handle_reminder_event_state_change from migration_carecircle_rca_fixes.sql before continuing.'


-- ── 2. Columns, only if you accept losing what they hold ────────────────────
-- ALTER TABLE public.notifications DROP COLUMN IF EXISTS scheduled_for;
-- ALTER TABLE public.notifications DROP COLUMN IF EXISTS medication_id;


-- ── 3. The web and the worker ───────────────────────────────────────────────
-- `notification-kinds.ts` reads both columns and degrades to the approximation
-- when they are NULL, so the client survives section 2 without a redeploy —
-- every row simply looks like a legacy row. The worker's LOW_STOCK insert
-- (src/scheduler.js) sets medication_id and WOULD fail against a dropped column,
-- so revert that line in the same change.
