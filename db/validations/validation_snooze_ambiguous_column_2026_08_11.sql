-- Validation for migration_snooze_ambiguous_column_2026_08_11.sql
-- Checks 1-3 are read-only. Run in the Supabase SQL editor AFTER applying the migration.
-- Every row should read DONE.
--
-- LESSON FROM THE BUG THIS FIXES: the original migration passed every catalog-inspecting check
-- and was still broken, because plpgsql only parses a function body on FIRST EXECUTION. Static
-- checks prove the definition landed; only running it proves it works. Check 4 below is the
-- executable one — and the true end-to-end proof is on the device (see the note at the bottom).

-- Checks 1-3, as ONE result set.
--
-- Deliberately a single UNION ALL query rather than three statements: the Supabase SQL editor
-- displays only the LAST statement's result when a script contains several, so a multi-statement
-- validation silently hides its own earlier checks. (Hit on 2026-08-11 — the run looked like it
-- had one check when it had three.)
SELECT * FROM (
  -- 1. The ambiguous read is gone and the qualified one is present.
  SELECT 1 AS n,
    CASE
      WHEN prosrc LIKE '%COALESCE(public.reminder_events.snooze_count, 0) + 1%'
       AND prosrc NOT LIKE '%snooze_count = COALESCE(snooze_count%'
      THEN 'DONE  1. snooze_count read is qualified (42702 ambiguity removed)'
      ELSE 'FAIL  1. bare snooze_count read still present — migration did not take effect'
    END AS result
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'snooze_reminder_event'

  UNION ALL

  -- 2. Still exactly one overload, SECURITY DEFINER, search_path pinned.
  SELECT 2,
    CASE
      WHEN COUNT(*) = 1
       AND bool_and(p.prosecdef)
       AND bool_and('search_path=public, auth' = ANY(COALESCE(p.proconfig, ARRAY[]::text[])))
      THEN 'DONE  2. one snooze_reminder_event, SECURITY DEFINER, search_path pinned'
      ELSE 'FAIL  2. found ' || COUNT(*) || ' overload(s): '
           || string_agg(pg_get_function_identity_arguments(p.oid), ' | ')
    END
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'snooze_reminder_event'

  UNION ALL

  -- 3. EXECUTE = authenticated only; anon and PUBLIC both denied.
  SELECT 3,
    CASE
      WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE')
       AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
       AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
      THEN 'DONE  3. EXECUTE = authenticated only (anon and PUBLIC both denied)'
      ELSE 'FAIL  3. authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
           || ' anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')
           || ' acl=' || COALESCE(p.proacl::text, 'null')
    END
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'snooze_reminder_event'
) checks
ORDER BY n;

-- 4. EXECUTABLE check — this is the one that would have caught the original bug.
--
--    Runs the function against a REAL currently-unresolved dose, impersonating that dose's own
--    owner, and then ROLLS BACK so nothing is actually changed. It touches real rows only inside
--    a transaction that is explicitly discarded.
--
--    HOW IT REPORTS: the block always ends by RAISE-ing, which both aborts the transaction (so
--    nothing it touched is kept — no explicit ROLLBACK to forget) and puts the verdict where the
--    SQL editor cannot hide it. Read the message text:
--
--      "VALIDATION OK: ..."        -> PASS. The function executed; the 42702 is gone.
--      "VALIDATION SKIP: ..."      -> no unresolved dose to test against; snooze one and re-run.
--      "column reference ... is ambiguous"  -> FAIL, the bug is still there.
--
--    Run this block on its own (select it and execute).

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
    RAISE EXCEPTION 'VALIDATION SKIP: no unresolved dose available to test against';
  END IF;

  SELECT * INTO v_med FROM public.medications WHERE id = v_event.medication_id;
  SELECT pr.id INTO v_owner FROM public.profiles pr
   WHERE pr.telegram_chat_id = v_med.telegram_id LIMIT 1;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'VALIDATION SKIP: could not resolve the owning profile for med %',
      v_event.medication_id;
  END IF;

  -- Make auth.uid() return the dose's real owner for this transaction only.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

  SELECT * INTO v_result
  FROM public.snooze_reminder_event(v_event.medication_id, v_event.scheduled_for, 10, 'VALIDATION');

  -- Deliberately RAISE on SUCCESS. It aborts the transaction, so this test cannot leave a real
  -- dose snoozed, and it surfaces the verdict as a message rather than a result set the editor
  -- might not show. Reaching this line at all is the pass condition: the UPDATE ran.
  RAISE EXCEPTION 'VALIDATION OK: snooze_reminder_event executed with no 42702 (event % -> status %, snooze_count %, capped %) — this error is intentional and nothing was saved',
    v_result.event_id, v_result.reminder_status, v_result.snooze_count, v_result.capped;
END $$;

-- 5. THE REAL PROOF IS THE DEVICE. The Android queue retries failed actions, so the snooze that
--    hit 42702 is still queued and will sync on the next flush (app open, next alarm, or the
--    WorkManager retry). Watch logcat for:
--
--      synced SNOOZE for med <id> (<drug>) scheduled <ORIGINAL dose instant>
--
--    and confirm the scheduled instant is the dose's own time, not the snooze re-fire time —
--    that half is fixed separately in AlarmScheduler.scheduleAt (see BRIDGE_CONTRACT.md §5).
