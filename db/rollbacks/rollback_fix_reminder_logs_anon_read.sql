-- ROLLBACK for migration_fix_reminder_logs_anon_read.sql
--
-- IMPORTANT: this rollback is deliberately FAIL-CLOSED. It reverts the *mechanism* this
-- migration introduced (FORCE RLS + the rebuilt SELECT policies) but does NOT recreate the
-- old USING(true) policies that caused the leak. Re-exposing every user's dose history is
-- never an acceptable "revert". If the forward migration somehow broke a legitimate read,
-- fix forward (correct the offending policy) rather than running this to re-open the data.
--
-- After this runs, reminder_logs / reminder_events remain RLS-protected. reminder_logs will
-- have no SELECT policy (deny-all for clients) until you reapply a scoped one; the bot is
-- unaffected (service_role bypasses RLS).

BEGIN;

-- Undo FORCE (keep RLS enabled).
ALTER TABLE public.reminder_logs   NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_events NO FORCE ROW LEVEL SECURITY;

-- Drop the reminder_logs policies this migration created.
DROP POLICY IF EXISTS "Users view own logs"          ON public.reminder_logs;
DROP POLICY IF EXISTS "Caregivers view patient logs" ON public.reminder_logs;

-- Deliberately do NOT drop "Users view own events": the forward migration only DROP/CREATEs it
-- (it pre-existed, from migration_remove_client_reminder_writes.sql). Dropping it here would
-- revoke a legitimate patient self-read the migration never introduced and break the dashboard's
-- events reads. It stays in place; it is correctly scoped either way.

COMMIT;

-- To restore correct scoped access after this rollback, re-run
-- migration_fix_reminder_logs_anon_read.sql (it is idempotent).
