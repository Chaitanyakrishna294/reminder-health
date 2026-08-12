-- Validation for migration_revoke_anon_execute_sweep_2026_08_13.sql
-- Read-only. Writes nothing. Run in the Supabase SQL editor AFTER applying.
--
-- One UNION ALL query so every row shows at once — separate SELECTs render only the
-- last result in the Supabase editor.
--
-- Check 1 is the goal. Checks 2-4 are the "did I break the app" half, and they
-- matter as much: a sweep that locks anon out by also locking `authenticated` out
-- has traded a security hole for an outage.

WITH ours AS (
  -- Our functions: public schema, not owned by an extension. Same predicate the
  -- migration used, so the two cannot disagree about what was in scope.
  SELECT p.oid, p.proname, p.proacl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e'
    )
)
SELECT 1 AS n,
  CASE WHEN (SELECT COUNT(*) FROM ours WHERE has_function_privilege('anon', oid, 'EXECUTE')) = 0
    THEN 'DONE  1. anon can execute NONE of our public functions'
    ELSE 'FAIL  1. anon still executes: ' || (
      SELECT string_agg(proname, ', ' ORDER BY proname)
      FROM ours WHERE has_function_privilege('anon', oid, 'EXECUTE')
    ) END AS result
UNION ALL
SELECT 2,
  -- A NULL acl means default privileges, which include PUBLIC. Checking for the
  -- empty grantee alone would miss it.
  CASE WHEN (SELECT COUNT(*) FROM ours
             WHERE proacl IS NULL
                OR EXISTS (SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee = 0)) = 0
    THEN 'DONE  2. no function of ours leaves PUBLIC holding EXECUTE'
    ELSE 'FAIL  2. PUBLIC still holds EXECUTE on: ' || (
      SELECT string_agg(proname, ', ' ORDER BY proname) FROM ours
      WHERE proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee = 0)
    ) END
UNION ALL
SELECT 3,
  -- The browser's RPCs must still work. These are the ones a logged-in user calls.
  CASE WHEN (SELECT COUNT(*) FROM ours
             WHERE proname = ANY (ARRAY['resolve_reminder_event','correct_reminder_event',
                   'ensure_my_profile','invite_caregiver','respond_to_caregiver_request',
                   'lookup_profile_by_connect_code','delete_my_account'])
               AND NOT has_function_privilege('authenticated', oid, 'EXECUTE')) = 0
    THEN 'DONE  3. authenticated kept EXECUTE on every browser-called RPC'
    ELSE 'FAIL  3. authenticated LOST: ' || (
      SELECT string_agg(proname, ', ' ORDER BY proname) FROM ours
      WHERE proname = ANY (ARRAY['resolve_reminder_event','correct_reminder_event',
            'ensure_my_profile','invite_caregiver','respond_to_caregiver_request',
            'lookup_profile_by_connect_code','delete_my_account'])
        AND NOT has_function_privilege('authenticated', oid, 'EXECUTE')
    ) END
UNION ALL
SELECT 4,
  -- The bot and cron. Losing these silently stops reminders, which is worse than
  -- anything this migration was fixing.
  CASE WHEN (SELECT COUNT(*) FROM ours
             WHERE proname = ANY (ARRAY['scan_and_escalate_overdue_reminders','close_daily_medications',
                   'try_acquire_scheduler_lock','release_scheduler_lock','resolve_reminder_event'])
               AND NOT has_function_privilege('service_role', oid, 'EXECUTE')) = 0
    THEN 'DONE  4. service_role kept EXECUTE on every scheduler RPC'
    ELSE 'FAIL  4. service_role LOST: ' || (
      SELECT string_agg(proname, ', ' ORDER BY proname) FROM ours
      WHERE proname = ANY (ARRAY['scan_and_escalate_overdue_reminders','close_daily_medications',
            'try_acquire_scheduler_lock','release_scheduler_lock','resolve_reminder_event'])
        AND NOT has_function_privilege('service_role', oid, 'EXECUTE')
    ) END
UNION ALL
SELECT 5,
  -- pg_trgm must be untouched, or catalog search breaks. This asserts the exclusion
  -- worked rather than trusting it.
  CASE WHEN has_function_privilege('authenticated', 'public.similarity(text,text)'::regprocedure, 'EXECUTE')
    THEN 'DONE  5. pg_trgm left alone — similarity() still executable (catalog search safe)'
    ELSE 'FAIL  5. pg_trgm was caught by the sweep — medication catalog search is broken' END
UNION ALL
SELECT 6,
  'INFO  6. functions in scope: ' || (SELECT COUNT(*)::text FROM ours)
  || ' ours, ' || (
    SELECT COUNT(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e')
  ) || ' extension-owned and deliberately skipped'
ORDER BY n;
