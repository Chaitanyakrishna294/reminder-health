-- Rollback for migration_revoke_anon_execute_sweep_2026_08_13.sql
--
-- READ THIS BEFORE RUNNING IT. The sweep closed two live holes, not just a policy
-- preference:
--   * lookup_profile_by_connect_code / lookup_caregiver_by_code have NO auth check
--     and return a real person's name and profile id from a short code.
--   * expire_stale_connection_requests and the cleanup_* functions have no auth
--     check and UPDATE/DELETE — including wiping `rate_limits`.
-- Restoring anon's EXECUTE puts both back within reach of the key shipped in the APK.
--
-- If the sweep broke something, the fix is almost always to GRANT the one function
-- to the one role that actually needed it — not to re-open all of them. Run the
-- validation first: checks 3 and 4 name exactly which role lost what.
--
-- This restores anon ONLY on the auth-guarded RPCs, deliberately. It does NOT
-- restore the two unauthenticated lookups or the unauthenticated cleanup functions,
-- because there is no failure mode where anon legitimately needs those and every
-- reason it should not have them. If you truly need those back, grant them by hand
-- and write down why.

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname = ANY (ARRAY[
        'resolve_reminder_event',
        'correct_reminder_event',
        'snooze_reminder_event',
        'ensure_my_profile',
        'get_my_telegram_chat_id',
        'is_anonymous_user',
        'invite_caregiver',
        'respond_to_caregiver_request',
        'delete_my_account',
        'redeem_link_code',
        'search_medication_catalog',
        'check_rate_limit'
      ])
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', r.sig);
  END LOOP;
END $$;
