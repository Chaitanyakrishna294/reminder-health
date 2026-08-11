-- Validation for migration_resolve_event_device_queue_2026_08_11.sql
-- Read-only. Run in the Supabase SQL editor AFTER applying the migration.
-- Every row should read DONE.

-- 1. Function still exists with the 6-arg signature, SECURITY DEFINER, search_path pinned.
--    (A CREATE OR REPLACE that accidentally changed the argument list would leave the OLD
--    function in place alongside a new overload, and clients would keep hitting the old one.)
SELECT
  CASE
    WHEN COUNT(*) = 1
     AND bool_and(p.prosecdef)
     AND bool_and('search_path=public, auth' = ANY(COALESCE(p.proconfig, ARRAY[]::text[])))
    THEN 'DONE  1. exactly one resolve_reminder_event, SECURITY DEFINER, search_path pinned'
    ELSE 'FAIL  1. found ' || COUNT(*) || ' overload(s): '
         || string_agg(pg_get_function_identity_arguments(p.oid), ' | ')
  END AS check_1
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'resolve_reminder_event';

-- 2. EXECUTE still granted to authenticated, and NOT to anon or PUBLIC.
--    This migration has no GRANT block of its own — it relies on the grants surviving
--    CREATE OR REPLACE. If someone had used DROP + CREATE instead, this check is what
--    catches the silent re-exposure. PUBLIC shows up as an empty grantee in aclexplode.
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
WHERE n.nspname = 'public' AND p.proname = 'resolve_reminder_event';

-- 3. The new definition landed: the two guards are now gated on the row lookup rather
--    than on p_event_id. Checked against the source text, since the behavioural
--    difference (a device action syncing after midnight) can't be produced read-only.
SELECT
  CASE
    WHEN prosrc LIKE '%IF v_existing_event.id IS NULL THEN%'
     AND prosrc LIKE '%v_backfill_window%'
     AND prosrc NOT LIKE '%IF (p_event_id IS NULL OR p_event_id <= 0) THEN%'
    THEN 'DONE  3. guards gated on the existing-row lookup, bounded backfill window present'
    ELSE 'FAIL  3. old p_event_id-gated guards still present — migration did not take effect'
  END AS check_3
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'resolve_reminder_event';

-- 4. Authorization still precedes the advisory lock and the row lookup. Ordering is a
--    security property here, not a style choice: an unauthorized caller must not be able
--    to take a lock that serializes against the scheduler.
SELECT
  CASE
    WHEN strpos(prosrc, 'NOT_AUTHORIZED') < strpos(prosrc, 'pg_advisory_xact_lock')
    THEN 'DONE  4. NOT_AUTHORIZED check precedes pg_advisory_xact_lock'
    ELSE 'FAIL  4. authorization no longer runs before the advisory lock'
  END AS check_4
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'resolve_reminder_event';

-- 5. The unique key the device relies on for idempotency still exists. Native sends
--    (medication_id, scheduled_for) and no event id, so this constraint is what makes a
--    duplicate sync a no-op rather than a second dose row.
SELECT
  CASE
    WHEN COUNT(*) >= 1
    THEN 'DONE  5. UNIQUE(medication_id, scheduled_for) present on reminder_events'
    ELSE 'FAIL  5. no unique constraint on (medication_id, scheduled_for) — device syncs could duplicate'
  END AS check_5
FROM pg_constraint c
WHERE c.conrelid = 'public.reminder_events'::regclass
  AND c.contype = 'u'
  AND (
    SELECT array_agg(a.attname ORDER BY a.attname)
    FROM unnest(c.conkey) k
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k
  ) = ARRAY['medication_id', 'scheduled_for'];

-- 6. Data check: no two rows describe the same dose at times differing only by seconds.
--    The device and the server compute scheduled_for independently (Kotlin
--    calculateNextReminder vs medications.next_reminder_at); both pin seconds to zero, and
--    if that ever drifted the UNIQUE above would NOT catch it — you would get two rows for
--    one dose, one resolved and one still pending, which is exactly a dose-gate re-ask.
SELECT
  CASE
    WHEN COUNT(*) = 0
    THEN 'DONE  6. no reminder_events rows with non-zero seconds in scheduled_for'
    ELSE 'WARN  6. ' || COUNT(*) || ' row(s) have non-zero seconds — device/server scheduled_for may not match exactly'
  END AS check_6
FROM public.reminder_events
WHERE EXTRACT(SECOND FROM scheduled_for) <> 0;
