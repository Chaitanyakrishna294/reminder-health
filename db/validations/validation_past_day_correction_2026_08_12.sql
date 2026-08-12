-- Validation for migration_past_day_correction_2026_08_12.sql
-- Read-only. Writes nothing. Run in the Supabase SQL editor AFTER applying.
--
-- TWO STATEMENTS, in this order, and the order is deliberate:
--   A. a COMPILE PROBE that actually calls the function, because plpgsql only
--      compiles a body on first execution — a catalog check passes happily on a
--      function that throws the moment anyone runs it. This is exactly how the
--      snooze RPC shipped with a 42702 that no validation caught (see APPLIED.md).
--      It raises AUTH_REQUIRED and writes nothing; reaching that error IS the pass.
--   B. one UNION ALL query, so every row is visible at once. Separate SELECTs render
--      only the LAST result in the Supabase editor, which previously led to a check
--      labelled check_4 reporting check 3's outcome.

-- ── A. COMPILE PROBE ────────────────────────────────────────────────────────
-- Expect: NOTICE "... raised P0001: AUTH_REQUIRED". Anything mentioning a syntax
-- error, an undefined column, or "column reference is ambiguous" is a FAIL.
DO $$
BEGIN
  PERFORM public.correct_reminder_event(NULL, 0, now(), 'TAKEN', NULL);
  RAISE NOTICE 'compile probe: FAIL — call unexpectedly succeeded with no auth';
EXCEPTION WHEN others THEN
  RAISE NOTICE 'compile probe: body compiled and reached runtime — raised %: %', SQLSTATE, SQLERRM;
END $$;

-- ── B. CHECKS ───────────────────────────────────────────────────────────────
WITH fn AS (
  SELECT p.oid, p.prosecdef, p.proconfig, p.proacl, p.prosrc
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'correct_reminder_event'
    AND pg_get_function_identity_arguments(p.oid)
        = 'p_event_id bigint, p_medication_id bigint, p_scheduled_for timestamp with time zone, p_action text, p_actor_role text'
)
SELECT 1 AS n,
  CASE WHEN EXISTS (SELECT 1 FROM fn)
    THEN 'DONE  1. correct_reminder_event exists with the expected 5-arg signature'
    ELSE 'FAIL  1. function missing or signature changed' END AS result
UNION ALL
SELECT 2,
  CASE WHEN (SELECT prosecdef FROM fn)
        AND 'search_path=public, auth' = ANY(COALESCE((SELECT proconfig FROM fn), ARRAY[]::text[]))
    THEN 'DONE  2. SECURITY DEFINER with search_path pinned'
    ELSE 'FAIL  2. definer=' || COALESCE((SELECT prosecdef FROM fn)::text, 'null')
         || ' config=' || COALESCE((SELECT proconfig FROM fn)::text, 'null') END
UNION ALL
SELECT 3,
  CASE WHEN has_function_privilege('authenticated', (SELECT oid FROM fn), 'EXECUTE')
        AND NOT has_function_privilege('anon', (SELECT oid FROM fn), 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM aclexplode((SELECT proacl FROM fn)) a WHERE a.grantee = 0)
    THEN 'DONE  3. EXECUTE = authenticated only (anon and PUBLIC both denied)'
    ELSE 'FAIL  3. acl=' || COALESCE((SELECT proacl FROM fn)::text, 'null') END
UNION ALL
SELECT 4,
  CASE WHEN (SELECT prosrc FROM fn) LIKE '%CANNOT_CORRECT_FUTURE_DOSE%'
    THEN 'DONE  4. future doses are refused server-side, not just hidden in the UI'
    ELSE 'FAIL  4. no future-dose guard in the function body' END
UNION ALL
SELECT 5,
  CASE WHEN (SELECT prosrc FROM fn) LIKE '%v_days_back > 7%'
    THEN 'DONE  5. correction window is 7 days back'
    ELSE 'FAIL  5. 7-day bound not found — window may still be same-day-only' END
UNION ALL
SELECT 6,
  CASE WHEN (SELECT prosrc FROM fn) LIKE '%EVENT_NOT_CORRECTABLE%'
        AND (SELECT prosrc FROM fn) LIKE '%v_is_past_day%'
    THEN 'DONE  6. past days accept an unanswered dose; today keeps the resolved-only rule'
    ELSE 'FAIL  6. past-day branch missing' END
UNION ALL
SELECT 7,
  -- The trigger must still forbid leaving a final state for anything other than the
  -- other final state. This migration deliberately does NOT touch it; check that some
  -- other change has not quietly relaxed it underneath us.
  CASE WHEN (SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'validate_reminder_event_status_transition')
       LIKE '%Forbidden transition%'
    THEN 'DONE  7. status-transition trigger still guards exits from a final state'
    ELSE 'FAIL  7. transition validator changed — adherence history is unprotected' END
UNION ALL
SELECT 8,
  -- Context, not a pass/fail: how much history the widened window actually exposes.
  'INFO  8. correctable unanswered doses in the last 7 days: ' || (
    SELECT COUNT(*)::text FROM public.reminder_events e
    JOIN public.medications m ON m.id = e.medication_id
    WHERE e.reminder_status IN ('MISSED', 'PENDING_REVIEW', 'UNCONFIRMED', 'ESCALATED_TO_CG')
      AND (e.scheduled_for AT TIME ZONE COALESCE(NULLIF(m.timezone, ''), 'Asia/Kolkata'))::date
          BETWEEN (now() AT TIME ZONE COALESCE(NULLIF(m.timezone, ''), 'Asia/Kolkata'))::date - 7
              AND (now() AT TIME ZONE COALESCE(NULLIF(m.timezone, ''), 'Asia/Kolkata'))::date - 1
  )
ORDER BY n;
