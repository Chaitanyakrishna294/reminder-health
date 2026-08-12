-- RE-MIND-eЯ: take EXECUTE away from anon across the whole public schema. 2026-08-13.
-- Idempotent — safe to re-run in the Supabase SQL Editor.
-- ============================================================================
--
-- The audit (db/audits/audit_function_execute_grants_2026_08_13.sql) came back with
-- 68 functions `anon` can execute. anon is the key SHIPPED INSIDE THE APK, which
-- anyone can unpack, so this is not theoretical reach. Two groups are live problems,
-- not defence-in-depth:
--
-- 1. UNAUTHENTICATED PII LOOKUP. `lookup_profile_by_connect_code(text)` and
--    `lookup_caregiver_by_code(text)` are SECURITY DEFINER with NO auth.uid() check
--    of any kind — they take a short code and return a real person's full_name and
--    profile UUID. Reachable by anon means anyone with the shipped key can walk the
--    connect-code space and harvest names. Both migrations that created them DID
--    write `REVOKE ALL ... FROM PUBLIC`, which is exactly why this went unnoticed:
--    the revoke ran, and Supabase's ALTER DEFAULT PRIVILEGES had already left a
--    separate DIRECT grant to anon that the PUBLIC revoke cannot touch.
--
-- 2. UNAUTHENTICATED MUTATION. `expire_stale_connection_requests()`,
--    `cleanup_expired_trash()`, `cleanup_expired_link_codes()` and
--    `cleanup_rate_limits()` take no arguments, check no caller, and UPDATE/DELETE.
--    An anon caller can mass-expire pending care-circle invitations, delete
--    notifications, empty the trash early, and — worst — wipe `rate_limits`, which
--    is the table that makes rate limiting mean anything.
--
-- The rest (resolve/correct_reminder_event, delete_my_account, invite_caregiver …)
-- do check auth.uid() and refuse at AUTH_REQUIRED, so for those this is
-- defence-in-depth: the first line of defence, restored, rather than relying on the
-- last one holding.
--
-- WHAT IS DELIBERATELY NOT TOUCHED: functions owned by an EXTENSION. That is 31 of
-- the 68 — all of pg_trgm (similarity, show_trgm, the gtrgm_* and gin_*trgm_*
-- operator-class internals). They are owned by supabase_admin, they carry no data
-- access, and the medication catalog's 254k-row trigram search depends on them.
-- Revoking there would break search to fix nothing, and `CREATE EXTENSION` would
-- restore the grants anyway. Excluded precisely, via pg_depend deptype='e', rather
-- than by guessing at name prefixes.
--
-- TRIGGER FUNCTIONS ARE INCLUDED and it is safe: PostgreSQL does not check EXECUTE
-- when firing a trigger — the function runs on the table owner's behalf regardless.
-- The grant was always meaningless surface area, which is what the 2026-07 migration
-- was reaching for when it revoked `authenticated` from them.
-- ============================================================================

-- ── 1. REVOKE ───────────────────────────────────────────────────────────────
-- BOTH revokes per function. PUBLIC covers access held by default (a NULL proacl
-- implies EXECUTE to PUBLIC, and every role is PUBLIC); the anon revoke covers the
-- separate direct grant. Neither alone is sufficient — that is the whole reason this
-- migration exists, and why `REVOKE ... FROM anon` in 2026-07 looked like it worked.
DO $$
DECLARE
  r RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      -- Skip anything an extension owns.
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'revoked PUBLIC + anon on % non-extension function(s)', v_count;
END $$;

-- ── 2. RE-GRANT WHAT ACTUALLY CALLS THEM ────────────────────────────────────
-- Step 1 was deliberately blunt, so this restores the two roles that legitimately
-- execute. Driven off NAMES so overloads are covered without hand-writing
-- signatures — a mistyped signature would silently grant nothing.
--
-- If a function in these lists does not exist, nothing happens; the loop simply
-- finds no rows. That keeps the migration safe to run against a database where a
-- future rename has landed.
DO $$
DECLARE
  r RECORD;
BEGIN
  -- Called from the browser with a logged-in session.
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname = ANY (ARRAY[
        'invite_caregiver',
        'respond_to_caregiver_request',
        'lookup_profile_by_connect_code',
        'lookup_caregiver_by_code',
        'ensure_my_profile',
        'get_my_telegram_chat_id',
        'is_anonymous_user',
        'resolve_reminder_event',
        'correct_reminder_event',
        'snooze_reminder_event',
        'redeem_link_code',
        'delete_my_account',
        'search_medication_catalog',
        'check_rate_limit'
      ])
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
  END LOOP;

  -- Called by the Render bot / Vercel cron, both service_role. The dose RPCs are
  -- here too: the device's offline queue drains through them server-side.
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname = ANY (ARRAY[
        'try_acquire_scheduler_lock',
        'release_scheduler_lock',
        'scan_and_escalate_overdue_reminders',
        'close_daily_medications',
        'expire_stale_connection_requests',
        'cleanup_expired_link_codes',
        'cleanup_expired_trash',
        'cleanup_rate_limits',
        'clean_old_chat_messages',
        'resolve_reminder_event',
        'correct_reminder_event',
        'snooze_reminder_event',
        'check_rate_limit'
      ])
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- NOTE ON pg_cron: its jobs run as their owner (postgres, a superuser), which
-- bypasses EXECUTE checks entirely. The cleanup functions above are granted to
-- service_role for the bot's sake, not for cron's — cron was never at risk here.
