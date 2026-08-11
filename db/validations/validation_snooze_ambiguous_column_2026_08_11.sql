-- Validation for migration_snooze_ambiguous_column_2026_08_11.sql
-- Checks 1-3 are read-only. Run in the Supabase SQL editor AFTER applying the migration.
-- Every row should read DONE.
--
-- LESSON FROM THE BUG THIS FIXES: the original migration passed every catalog-inspecting check
-- and was still broken, because plpgsql only parses a function body on FIRST EXECUTION. Static
-- checks prove the definition landed; only running it proves it works. Check 4 below is the
-- executable one — and the true end-to-end proof is on the device (see the note at the bottom).

-- 1. The ambiguous read is gone and the qualified one is present.
SELECT
  CASE
    WHEN prosrc LIKE '%COALESCE(public.reminder_events.snooze_count, 0) + 1%'
     AND prosrc NOT LIKE '%snooze_count = COALESCE(snooze_count%'
    THEN 'DONE  1. snooze_count read is qualified (42702 ambiguity removed)'
    ELSE 'FAIL  1. bare snooze_count read still present — migration did not take effect'
  END AS check_1
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'snooze_reminder_event';

-- 2. Still exactly one overload, SECURITY DEFINER, search_path pinned.
SELECT
  CASE
    WHEN COUNT(*) = 1
     AND bool_and(p.prosecdef)
     AND bool_and('search_path=public, auth' = ANY(COALESCE(p.proconfig, ARRAY[]::text[])))
    THEN 'DONE  2. one snooze_reminder_event, SECURITY DEFINER, search_path pinned'
    ELSE 'FAIL  2. found ' || COUNT(*) || ' overload(s): '
         || string_agg(pg_get_function_identity_arguments(p.oid), ' | ')
  END AS check_2
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'snooze_reminder_event';

-- 3. EXECUTE = authenticated only; anon and PUBLIC both denied.
SELECT
  CASE
    WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
    THEN 'DONE  3. EXECUTE = authenticated only (anon and PUBLIC both denied)'
    ELSE 'FAIL  3. authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
         || ' anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')
         || ' acl=' || COALESCE(p.proacl::text, 'null')
  END AS check_4
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'snooze_reminder_event';

-- 4. EXECUTABLE check — this is the one that would have caught the original bug.
--
--    Runs the function against a REAL currently-unresolved dose, impersonating that dose's own
--    owner, and then ROLLS BACK so nothing is actually changed. It touches real rows only inside
--    a transaction that is explicitly discarded.
--
--    Run this block on its own (select it and execute), so the ROLLBACK is unambiguous.
--    If it prints SKIP, there is simply no unresolved dose to test against right now — snooze a
--    dose on the device and re-run, or rely on the device proof below.

BEGIN;

DO $$
DECLARE
  v_med    public.medications%ROWTYPE;
  v_event  public.reminder_events%ROWTYPE;
  v_owner  UUID;
  v_result RECORD;
BEGIN
  SELECT e.* INTO v_event
  FROM public.reminder_events e
  WHERE e.reminder_status NOT IN ('TAKEN', 'SKIPPED')
    AND COALESCE(e.snooze_count, 0) < 3
  ORDER BY e.scheduled_for DESC
  LIMIT 1;

  IF v_event.id IS NULL THEN
    RAISE NOTICE 'SKIP  4. no unresolved dose available to test against';
    RETURN;
  END IF;

  SELECT * INTO v_med FROM public.medications WHERE id = v_event.medication_id;
  SELECT pr.id INTO v_owner FROM public.profiles pr
   WHERE pr.telegram_chat_id = v_med.telegram_id LIMIT 1;

  IF v_owner IS NULL THEN
    RAISE NOTICE 'SKIP  4. could not resolve the owning profile for med %', v_event.medication_id;
    RETURN;
  END IF;

  -- Make auth.uid() return the dose's real owner for this transaction only.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

  SELECT * INTO v_result
  FROM public.snooze_reminder_event(v_event.medication_id, v_event.scheduled_for, 10, 'VALIDATION');

  RAISE NOTICE 'DONE  4. snooze_reminder_event EXECUTED without 42702 (event % -> status %, snooze_count %, capped %)',
    v_result.event_id, v_result.reminder_status, v_result.snooze_count, v_result.capped;
END $$;

ROLLBACK;

-- 5. THE REAL PROOF IS THE DEVICE. The Android queue retries failed actions, so the snooze that
--    hit 42702 is still queued and will sync on the next flush (app open, next alarm, or the
--    WorkManager retry). Watch logcat for:
--
--      synced SNOOZE for med <id> (<drug>) scheduled <ORIGINAL dose instant>
--
--    and confirm the scheduled instant is the dose's own time, not the snooze re-fire time —
--    that half is fixed separately in AlarmScheduler.scheduleAt (see BRIDGE_CONTRACT.md §5).
