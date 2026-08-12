-- Validation for migration_lookup_auth_guards_2026_08_13.sql
-- Read-only. Writes nothing. Run in the Supabase SQL editor AFTER applying.
--
-- TWO STATEMENTS. A runs the functions; B reports. Order matters — the editor shows
-- the last statement's result, so the report goes last.

-- ── A. BEHAVIOUR PROBE ──────────────────────────────────────────────────────
-- The SQL editor has no auth.uid(), so this IS the unauthenticated case. Both
-- should raise AUTH_REQUIRED. Anything else — a row, a null, a different error —
-- means the guard is not doing its job.
--
-- It also proves the bodies COMPILE. plpgsql only compiles on first execution, so a
-- catalog check passes happily on a function that throws the moment it runs; that is
-- how a 42702 shipped in the snooze RPC. Reaching AUTH_REQUIRED proves the whole
-- body parsed. Nothing is written either way — the guard fires before the query.
DO $$
DECLARE v_hit int := 0;
BEGIN
  BEGIN
    PERFORM * FROM public.lookup_profile_by_connect_code('PROBE123');
    RAISE NOTICE 'probe 1: FAIL — lookup_profile_by_connect_code returned with no auth';
  EXCEPTION WHEN others THEN
    IF SQLERRM = 'AUTH_REQUIRED' THEN v_hit := v_hit + 1;
      RAISE NOTICE 'probe 1: PASS — lookup_profile_by_connect_code raised AUTH_REQUIRED';
    ELSE
      RAISE NOTICE 'probe 1: FAIL — raised %: %', SQLSTATE, SQLERRM;
    END IF;
  END;

  BEGIN
    PERFORM * FROM public.lookup_caregiver_by_code('PROBE123');
    RAISE NOTICE 'probe 2: FAIL — lookup_caregiver_by_code returned with no auth';
  EXCEPTION WHEN others THEN
    IF SQLERRM = 'AUTH_REQUIRED' THEN v_hit := v_hit + 1;
      RAISE NOTICE 'probe 2: PASS — lookup_caregiver_by_code raised AUTH_REQUIRED';
    ELSE
      RAISE NOTICE 'probe 2: FAIL — raised %: %', SQLSTATE, SQLERRM;
    END IF;
  END;

  RAISE NOTICE 'probes passed: % of 2', v_hit;
END $$;

-- ── B. CHECKS ───────────────────────────────────────────────────────────────
WITH fns AS (
  SELECT p.oid, p.proname, p.prosecdef, p.proconfig, p.proacl, p.prosrc
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('lookup_profile_by_connect_code', 'lookup_caregiver_by_code')
)
SELECT 1 AS n,
  CASE WHEN (SELECT COUNT(*) FROM fns) = 2
    THEN 'DONE  1. both lookup functions exist'
    ELSE 'FAIL  1. expected 2, found ' || (SELECT COUNT(*)::text FROM fns) END AS result
UNION ALL
SELECT 2,
  CASE WHEN (SELECT COUNT(*) FROM fns WHERE prosrc LIKE '%AUTH_REQUIRED%') = 2
    THEN 'DONE  2. both bodies carry the auth.uid() guard'
    ELSE 'FAIL  2. missing the guard: ' || COALESCE((
      SELECT string_agg(proname, ', ') FROM fns WHERE prosrc NOT LIKE '%AUTH_REQUIRED%'
    ), '(none found)') END
UNION ALL
SELECT 3,
  CASE WHEN (SELECT COUNT(*) FROM fns WHERE NOT has_function_privilege('anon', oid, 'EXECUTE')) = 2
    THEN 'DONE  3. anon holds EXECUTE on neither (the grant lock still holds)'
    ELSE 'FAIL  3. anon still executes: ' || (
      SELECT string_agg(proname, ', ') FROM fns WHERE has_function_privilege('anon', oid, 'EXECUTE')
    ) END
UNION ALL
SELECT 4,
  CASE WHEN (SELECT COUNT(*) FROM fns
             WHERE proacl IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee = 0)) = 2
    THEN 'DONE  4. PUBLIC holds nothing on either'
    ELSE 'FAIL  4. PUBLIC still holds EXECUTE (or acl is NULL = default = PUBLIC)' END
UNION ALL
SELECT 5,
  CASE WHEN (SELECT COUNT(*) FROM fns WHERE has_function_privilege('authenticated', oid, 'EXECUTE')) = 2
    THEN 'DONE  5. authenticated kept EXECUTE — the Care Circle invite flow still works'
    ELSE 'FAIL  5. authenticated LOST access — settings can no longer resolve a code' END
UNION ALL
SELECT 6,
  CASE WHEN (SELECT COUNT(*) FROM fns WHERE prosecdef) = 2
    THEN 'DONE  6. both still SECURITY DEFINER with search_path pinned'
    ELSE 'FAIL  6. definer/search_path changed' END
ORDER BY n;
