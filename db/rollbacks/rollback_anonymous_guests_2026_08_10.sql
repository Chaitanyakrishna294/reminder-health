-- ROLLBACK for migration_anonymous_guests_2026_08_10.sql
--
-- Drops the guest write guards. NOT destructive to data — no guest account or
-- medication is touched — but note what it re-opens: with these triggers gone,
-- anonymous sessions can insert caregiver_connections (which notify real people)
-- and health_records (which store files). If the reason for rolling back is that
-- the guard is misfiring on REAL users, prefer turning OFF anonymous sign-ins in
-- the Supabase dashboard first — that removes the guests without removing the
-- protection, and it takes effect immediately.
--
-- Existing guest accounts survive this rollback and keep working; they are
-- ordinary auth.users rows with ordinary profiles.
--
-- Idempotent; safe to re-run in the Supabase SQL Editor.

BEGIN;

DROP TRIGGER IF EXISTS guard_guest_write_caregiver_connections ON public.caregiver_connections;
DROP TRIGGER IF EXISTS guard_guest_write_health_records ON public.health_records;

DROP FUNCTION IF EXISTS public.guard_guest_write();
DROP FUNCTION IF EXISTS public.is_anonymous_user();

NOTIFY pgrst, 'reload schema';

COMMIT;
