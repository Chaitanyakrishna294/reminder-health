-- Rollback for migration_revoke_anon_execute_2026_08_13.sql
--
-- THIS IS ALMOST CERTAINLY NOT WHAT YOU WANT. The migration removed EXECUTE on
-- correct_reminder_event from `anon` — the key shipped inside the APK, which anyone
-- can unpack. Restoring it re-opens a dose-history-rewriting function to
-- unauthenticated callers. The function's own body still refuses them at
-- AUTH_REQUIRED, so the practical exposure is small, but "the last line of defence
-- happens to hold" is not a reason to remove the first one.
--
-- The only legitimate reason to run this is if revoking broke a caller nobody knew
-- about — in which case the fix is to identify that caller and grant it a proper
-- role, not to hand the function back to anon.
--
-- Restores the state the validation reported as FAIL (check 3), deliberately.

GRANT EXECUTE ON FUNCTION public.correct_reminder_event(bigint, bigint, timestamptz, text, text) TO anon;

-- NOT restored: the PUBLIC grant. Rolling back one questionable decision should not
-- quietly re-open a second, wider one — PUBLIC covers every role that exists now or
-- later, and nothing has ever needed it here.
