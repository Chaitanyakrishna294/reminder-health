-- Validation for migration_snooze_reminder_event_2026_08_11.sql
-- Read-only. Run in the Supabase SQL editor AFTER applying the migration.
-- Every row should read DONE.

-- 1. Function exists, is SECURITY DEFINER, and has search_path pinned.
SELECT
  CASE
    WHEN p.prosecdef
     AND 'search_path=public, auth' = ANY(COALESCE(p.proconfig, ARRAY[]::text[]))
    THEN 'DONE  1. snooze_reminder_event is SECURITY DEFINER with search_path pinned'
    ELSE 'FAIL  1. definer=' || p.prosecdef || ' config=' || COALESCE(p.proconfig::text, 'null')
  END AS check_1
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'snooze_reminder_event';

-- 2. EXECUTE granted to authenticated, and NOT to anon or PUBLIC.
--    PUBLIC shows up as an empty grantee in aclexplode.
SELECT
  CASE
    WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT EXISTS (
       SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0
     )
    THEN 'DONE  2. EXECUTE = authenticated only (anon and PUBLIC both denied)'
    ELSE 'FAIL  2. authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
         || ' anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')
         || ' acl=' || COALESCE(p.proacl::text, 'null')
  END AS check_2
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'snooze_reminder_event';

-- 3. SNOOZED is still a permitted reminder_status (the RPC writes it).
SELECT
  CASE
    WHEN pg_get_constraintdef(c.oid) LIKE '%SNOOZED%'
    THEN 'DONE  3. reminder_events status CHECK still allows SNOOZED'
    ELSE 'FAIL  3. ' || pg_get_constraintdef(c.oid)
  END AS check_3
FROM pg_constraint c
WHERE c.conrelid = 'public.reminder_events'::regclass
  AND c.contype = 'c'
  AND pg_get_constraintdef(c.oid) LIKE '%reminder_status%';

-- 4. The columns the RPC writes all exist.
SELECT
  CASE
    WHEN COUNT(*) = 4
    THEN 'DONE  4. reminder_status / retry_reminder_at / snooze_count / resolution_channel all present'
    ELSE 'FAIL  4. only found: ' || string_agg(column_name, ', ')
  END AS check_4
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'reminder_events'
  AND column_name IN ('reminder_status', 'retry_reminder_at', 'snooze_count', 'resolution_channel');

-- 5. Sanity: the scheduler's snooze re-fire branch selects on these, so confirm
--    nothing is currently parked in an impossible state (snoozed with no retry time).
SELECT
  CASE
    WHEN COUNT(*) = 0
    THEN 'DONE  5. no SNOOZED rows missing retry_reminder_at'
    ELSE 'WARN  5. ' || COUNT(*) || ' SNOOZED row(s) have NULL retry_reminder_at (pre-existing data)'
  END AS check_5
FROM public.reminder_events
WHERE reminder_status = 'SNOOZED' AND retry_reminder_at IS NULL;
