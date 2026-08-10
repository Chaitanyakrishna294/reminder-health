-- ROLLBACK for migration_dose_days_2026_08_10.sql
--
-- DESTRUCTIVE: dropping the column discards every non-daily schedule a user has
-- saved. Any medication set to "Mon/Wed/Fri" silently reverts to firing EVERY
-- DAY — patients start being reminded to take doses they should not take. That
-- is the same failure the migration exists to fix, so prefer rolling back the
-- CODE first and leaving the column in place: with old code deployed the column
-- is inert (nothing reads it), and the saved schedules survive for when you
-- redeploy.
--
-- Only run this if the column itself is the problem.
--
-- Before dropping, see what you are about to destroy:
--   SELECT id, drug_name, telegram_id, dose_days
--   FROM public.medications
--   WHERE dose_days IS NOT NULL;
--
-- Idempotent; safe to re-run in the Supabase SQL Editor.

BEGIN;

ALTER TABLE public.medications DROP CONSTRAINT IF EXISTS medications_dose_days_valid;
ALTER TABLE public.medications DROP COLUMN IF EXISTS dose_days;

NOTIFY pgrst, 'reload schema';

COMMIT;
