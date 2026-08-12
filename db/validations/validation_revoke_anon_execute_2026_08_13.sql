-- Validation for migration_revoke_anon_execute_2026_08_13.sql
-- Read-only. Run in the Supabase SQL editor AFTER applying.
--
-- Rows 1-4 are this migration's own checks. Row 5 is the one that matters beyond it:
-- the same PUBLIC-vs-direct grant confusion applies to EVERY function in the schema,
-- so it counts how many others are still reachable by anon. Expect to act on it.
--
-- One UNION ALL query, so every row shows at once — separate SELECTs render only the
-- last result in the Supabase editor, which is how a check labelled 4 once reported
-- check 3's outcome.

WITH fn AS (
  SELECT p.oid, p.proacl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'correct_reminder_event'
    AND pg_get_function_identity_arguments(p.oid)
        = 'p_event_id bigint, p_medication_id bigint, p_scheduled_for timestamp with time zone, p_action text, p_actor_role text'
)
SELECT 1 AS n,
  CASE WHEN NOT has_function_privilege('anon', (SELECT oid FROM fn), 'EXECUTE')
    THEN 'DONE  1. anon can NOT execute correct_reminder_event'
    ELSE 'FAIL  1. anon still holds EXECUTE — acl=' || COALESCE((SELECT proacl FROM fn)::text, 'NULL (default = PUBLIC)') END AS result
UNION ALL
SELECT 2,
  -- PUBLIC shows up as an empty grantee in aclexplode. A NULL acl is ALSO a fail
  -- here: NULL means default privileges, which include EXECUTE for PUBLIC.
  CASE WHEN (SELECT proacl FROM fn) IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM aclexplode((SELECT proacl FROM fn)) a WHERE a.grantee = 0)
    THEN 'DONE  2. PUBLIC holds nothing (acl is materialised, no empty grantee)'
    ELSE 'FAIL  2. PUBLIC still holds EXECUTE — acl=' || COALESCE((SELECT proacl FROM fn)::text, 'NULL (default = PUBLIC)') END
UNION ALL
SELECT 3,
  CASE WHEN has_function_privilege('authenticated', (SELECT oid FROM fn), 'EXECUTE')
    THEN 'DONE  3. authenticated kept EXECUTE (the web app still works)'
    ELSE 'FAIL  3. authenticated LOST EXECUTE — the Change button is broken' END
UNION ALL
SELECT 4,
  CASE WHEN has_function_privilege('service_role', (SELECT oid FROM fn), 'EXECUTE')
    THEN 'DONE  4. service_role kept EXECUTE'
    ELSE 'FAIL  4. service_role lost EXECUTE' END
UNION ALL
SELECT 5,
  -- THE BLAST RADIUS. Same defect, every other function. Not scoped to SECURITY
  -- DEFINER: an INVOKER function reachable by anon is still surface area.
  CASE WHEN (
    SELECT COUNT(*) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ) = 0
    THEN 'DONE  5. no other public function is executable by anon'
    ELSE 'WARN  5. ' || (
      SELECT COUNT(*)::text FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind = 'f'
        AND has_function_privilege('anon', p.oid, 'EXECUTE')
    ) || ' other public function(s) still executable by anon — run db/audits/audit_function_execute_grants_2026_08_13.sql for the list'
  END
ORDER BY n;
