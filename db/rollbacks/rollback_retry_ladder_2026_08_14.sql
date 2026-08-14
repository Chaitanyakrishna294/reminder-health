-- Rollback for migration_retry_ladder_2026_08_14.sql
--
-- Drops the constraint FIRST — dropping a column referenced by a CHECK would
-- take the constraint with it silently, and doing it explicitly keeps the two
-- steps legible if only one of them is wanted.
--
-- DROPPING THE COLUMNS DISCARDS ANY CUSTOM LADDERS. Every affected medication
-- reverts to its priority default, which is a safe state rather than a broken
-- one — the device keeps retrying, just on the default rhythm. Nothing else
-- reads these columns, so the fallout is bounded to that.
--
-- The web half degrades on its own: retryOffsets() takes NULL config and returns
-- the priority default, so an un-migrated database behaves exactly as it did
-- before the feature.
-- ============================================================================

ALTER TABLE public.medications
  DROP CONSTRAINT IF EXISTS medications_retry_ladder_within_cap;

ALTER TABLE public.medications
  DROP COLUMN IF EXISTS retry_ladder_interval_minutes,
  DROP COLUMN IF EXISTS retry_ladder_count;
