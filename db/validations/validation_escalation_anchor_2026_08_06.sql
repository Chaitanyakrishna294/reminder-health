-- Validation queries for migration_escalation_anchor_2026_08_06.sql
-- Paste each block into the Supabase SQL editor AFTER applying the migration.
-- Expected results are stated in the comment above each query.

-- ============================================================================
-- 1. The anchor column exists with the right type.
-- EXPECT: 1 row — column_name = last_prompted_at,
--         data_type = 'timestamp with time zone', is_nullable = 'YES'.
-- ============================================================================
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'reminder_events'
  AND column_name = 'last_prompted_at';

-- ============================================================================
-- 2. Column population sanity. There is NO backfill — by design: the anchor
--    COALESCEs to created_at (= initial-send time for this table), so a
--    backfill would have written values the COALESCE already produces. NULL is
--    the expected steady state for every row that never had a snooze re-fire.
-- EXPECT: 1 row, no error; anomalous_rows = 0. Immediately after applying the
--         migration, stamped_rows = 0 (only snooze re-fires stamp the column,
--         and only after the worker/web code deploys). null_rows staying high
--         forever is NORMAL — it is not a defect signal.
-- ============================================================================
SELECT COUNT(*)                                              AS total_rows,
       COUNT(*) FILTER (WHERE last_prompted_at IS NULL)      AS null_rows,
       COUNT(*) FILTER (WHERE last_prompted_at IS NOT NULL)  AS stamped_rows,
       COUNT(*) FILTER (WHERE last_prompted_at < created_at) AS anomalous_rows
FROM public.reminder_events;

-- ============================================================================
-- 3a. The live function body is anchored to last_prompted_at AND clamped.
-- EXPECT: uses_anchor_column = t, anchor_expression_present = t,
--         clamp_ceiling_present = t.
-- ============================================================================
SELECT def LIKE '%last_prompted_at%'                                   AS uses_anchor_column,
       def LIKE '%GREATEST(v_rec.r_scheduled_for%'                     AS anchor_expression_present,
       def LIKE '%COALESCE(v_rec.r_created_at, v_rec.r_scheduled_for) + interval ''30 minutes''%'
                                                                       AS clamp_ceiling_present
FROM (SELECT pg_get_functiondef('public.scan_and_escalate_overdue_reminders()'::regprocedure) AS def) d;

-- ============================================================================
-- 3b. EVERY threshold comparison measures from the anchor, and NONE still
--     measures from the raw due time.
-- EXPECT: anchored_thresholds = 8 (critical 10/20/60, important 20/45/90,
--         normal 60/120), due_time_thresholds = 0.
-- ============================================================================
SELECT (LENGTH(def) - LENGTH(REPLACE(def, 'v_anchor + interval', '')))
         / LENGTH('v_anchor + interval')                                AS anchored_thresholds,
       (LENGTH(def) - LENGTH(REPLACE(def, 'r_scheduled_for + interval', '')))
         / LENGTH('r_scheduled_for + interval')                         AS due_time_thresholds
FROM (SELECT pg_get_functiondef('public.scan_and_escalate_overdue_reminders()'::regprocedure) AS def) d;

-- ============================================================================
-- 3c. The interval VALUES themselves are unchanged from 5.7b — this checks the
--     numbers, not merely that thresholds reference the anchor. Counts each
--     exact threshold literal in the live function body.
-- EXPECT: t_10m = 1 (critical gentle), t_20m = 2 (critical escalate +
--         important gentle), t_45m = 1 (important escalate), t_60m = 2
--         (critical review + normal gentle), t_90m = 1 (important review),
--         t_120m = 1 (normal review), cooldown_30m = 2 (the two
--         patient_escalation_state cooldowns), clamp_ceiling_30m = 1.
-- ============================================================================
SELECT (LENGTH(def) - LENGTH(REPLACE(def, 'v_anchor + interval ''10 minutes''', '')))
         / LENGTH('v_anchor + interval ''10 minutes''')                  AS t_10m,
       (LENGTH(def) - LENGTH(REPLACE(def, 'v_anchor + interval ''20 minutes''', '')))
         / LENGTH('v_anchor + interval ''20 minutes''')                  AS t_20m,
       (LENGTH(def) - LENGTH(REPLACE(def, 'v_anchor + interval ''45 minutes''', '')))
         / LENGTH('v_anchor + interval ''45 minutes''')                  AS t_45m,
       (LENGTH(def) - LENGTH(REPLACE(def, 'v_anchor + interval ''60 minutes''', '')))
         / LENGTH('v_anchor + interval ''60 minutes''')                  AS t_60m,
       (LENGTH(def) - LENGTH(REPLACE(def, 'v_anchor + interval ''90 minutes''', '')))
         / LENGTH('v_anchor + interval ''90 minutes''')                  AS t_90m,
       (LENGTH(def) - LENGTH(REPLACE(def, 'v_anchor + interval ''120 minutes''', '')))
         / LENGTH('v_anchor + interval ''120 minutes''')                 AS t_120m,
       (LENGTH(def) - LENGTH(REPLACE(def, 'v_now + interval ''30 minutes''', '')))
         / LENGTH('v_now + interval ''30 minutes''')                     AS cooldown_30m,
       (LENGTH(def) - LENGTH(REPLACE(def, 'r_scheduled_for) + interval ''30 minutes''', '')))
         / LENGTH('r_scheduled_for) + interval ''30 minutes''')          AS clamp_ceiling_30m
FROM (SELECT pg_get_functiondef('public.scan_and_escalate_overdue_reminders()'::regprocedure) AS def) d;

-- ============================================================================
-- 4. The security-lockdown ACL survived the CREATE OR REPLACE.
--    (migration_security_lockdown_2026_07_29.sql section A, applied 2026-08-06)
-- EXPECT: 1 row — anon_exec = f, authenticated_exec = f, service_role_exec = t.
-- ============================================================================
SELECT p.oid::regprocedure                                       AS function,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  AS service_role_exec
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'scan_and_escalate_overdue_reminders';

-- ============================================================================
-- 5. Behavior spot-check (read-only): computes the SAME clamped anchor
--    expression the function uses, over currently-scannable rows.
--    (Rewritten: the previous EXPECT "anchor >= scheduled_for on every row"
--    was a tautology — GREATEST(scheduled_for, ...) guarantees it by
--    construction — and was not observable from this count-only output.)
-- EXPECT: no error, exactly 1 row. delayed_rows and clamped_rows are
--         informational, not pass/fail: on an on-time system with no active
--         snoozes both are typically 0. delayed_rows = doses whose ladder is
--         currently anchored later than the due time (late delivery or snooze
--         re-fire); clamped_rows = doses where the 30-minute ceiling is
--         actively bounding the anchor (repeated snoozes).
-- ============================================================================
SELECT COUNT(*) AS scannable_rows,
       COUNT(*) FILTER (
         WHERE LEAST(
                 GREATEST(scheduled_for, COALESCE(last_prompted_at, created_at, scheduled_for)),
                 COALESCE(created_at, scheduled_for) + interval '30 minutes')
               > scheduled_for
       ) AS delayed_rows,
       COUNT(*) FILTER (
         WHERE GREATEST(scheduled_for, COALESCE(last_prompted_at, created_at, scheduled_for))
               > COALESCE(created_at, scheduled_for) + interval '30 minutes'
       ) AS clamped_rows
FROM public.reminder_events
WHERE reminder_status IN ('SENT', 'DISPLAYED', 'OPENED', 'GENTLE_REMINDER', 'ESCALATED');
