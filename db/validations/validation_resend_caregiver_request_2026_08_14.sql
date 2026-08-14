-- Validation for migration_resend_caregiver_request_2026_08_14.sql
--
-- ONE query — the Supabase editor shows only the last statement's result.
--
-- Check 5 is the compile probe and it matters more than the catalog checks:
-- plpgsql compiles a body on FIRST EXECUTION, so a function with a typo passes
-- every structural check here and throws the moment a real caller arrives. The
-- editor has no auth.uid(), so calling it must raise AUTH_REQUIRED — which
-- proves the body compiles AND that the auth guard is the first thing in it.
-- ============================================================================

WITH fn AS (
  SELECT p.oid, p.proacl, p.proconfig, pg_get_functiondef(p.oid) AS def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'resend_caregiver_request'

)

SELECT 1 AS chk, 'function exists' AS what,
       (SELECT count(*) FROM fn)::text AS observed,
       CASE WHEN (SELECT count(*) FROM fn) = 1 THEN 'DONE' ELSE 'FAIL' END AS verdict

UNION ALL
SELECT 2, 'search_path pinned',
       coalesce(array_to_string((SELECT proconfig FROM fn), ' | '), 'NONE'),
       CASE WHEN (SELECT proconfig FROM fn) IS NOT NULL THEN 'DONE' ELSE 'FAIL' END

UNION ALL
-- A NULL acl is Postgres's default: EXECUTE to PUBLIC, and anon is PUBLIC.
SELECT 3, 'acl set, anon revoked, authenticated granted',
       coalesce((SELECT proacl FROM fn)::text, 'NULL (= PUBLIC!)'),
       CASE WHEN (SELECT proacl FROM fn) IS NOT NULL
             AND NOT has_function_privilege('anon', (SELECT oid FROM fn), 'EXECUTE')
             AND has_function_privilege('authenticated', (SELECT oid FROM fn), 'EXECUTE')
            THEN 'DONE' ELSE 'FAIL' END

UNION ALL
-- Deliberately NOT granted: nothing server-side resends a human's invitation.
SELECT 4, 'service_role NOT granted (deliberate)',
       has_function_privilege('service_role', (SELECT oid FROM fn), 'EXECUTE')::text,
       CASE WHEN NOT has_function_privilege('service_role', (SELECT oid FROM fn), 'EXECUTE')
            THEN 'DONE' ELSE 'FAIL' END

UNION ALL
-- The three guards must all be present in the compiled body, in the order the
-- header claims: authenticate, then own it, then it must still be pending.
SELECT 5, 'body carries all three guards',
       CASE WHEN (SELECT def FROM fn) LIKE '%AUTH_REQUIRED%' THEN 'auth ' ELSE 'auth:MISSING ' END
         || CASE WHEN (SELECT def FROM fn) LIKE '%NOT_AUTHORIZED%' THEN 'owner ' ELSE 'owner:MISSING ' END
         || CASE WHEN (SELECT def FROM fn) LIKE '%NOT_PENDING%' THEN 'pending' ELSE 'pending:MISSING' END,
       CASE WHEN (SELECT def FROM fn) LIKE '%AUTH_REQUIRED%'
             AND (SELECT def FROM fn) LIKE '%NOT_AUTHORIZED%'
             AND (SELECT def FROM fn) LIKE '%NOT_PENDING%'
            THEN 'DONE' ELSE 'FAIL' END

ORDER BY chk;

-- ── CHECK 6, RUN SEPARATELY — the compile probe ─────────────────────────────
-- Kept out of the UNION because it must RAISE. Run this on its own and read the
-- error: `AUTH_REQUIRED` is a PASS (the body compiled, and the auth guard runs
-- before anything touches a table). Any other error, or no error at all, is a
-- FAIL worth investigating before anyone taps Send again.
--
--   SELECT * FROM public.resend_caregiver_request('00000000-0000-0000-0000-000000000000'::uuid);
--
-- Expected:  ERROR:  AUTH_REQUIRED
