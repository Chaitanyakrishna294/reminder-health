-- READ-ONLY — paste into the Supabase SQL editor and run. Changes nothing.
-- Confirms migration_refill_reminder.sql and migration_escalation_anchor_2026_08_06.sql
-- are FULLY applied (every object present, legacy trigger removed, ACL correct).
-- Read the `status` column: DONE = applied correctly, TODO = missing/not applied.

SELECT ord, check_name, status, detail FROM (

  -- ── REFILL ──────────────────────────────────────────────────────────────
  -- R1: the suppression column the 09:00 low-stock cron filters on.
  SELECT 1 AS ord, 'R1 medications.low_stock_notified_at' AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_schema='public' AND table_name='medications'
                             AND column_name='low_stock_notified_at') THEN 'DONE' ELSE 'TODO' END AS status,
         '' AS detail

  UNION ALL
  -- R2: notifications CHECK constraint must allow 'LOW_STOCK'.
  SELECT 2, 'R2 notifications LOW_STOCK type',
         CASE WHEN EXISTS (SELECT 1 FROM pg_constraint
                           WHERE conname='notifications_type_check'
                             AND pg_get_constraintdef(oid) ILIKE '%LOW_STOCK%') THEN 'DONE' ELSE 'TODO' END,
         ''

  UNION ALL
  -- R3: rearm function + its BEFORE UPDATE trigger.
  SELECT 3, 'R3 rearm_low_stock_notice fn+trigger',
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                           WHERE n.nspname='public' AND p.proname='rearm_low_stock_notice')
                AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trigger_rearm_low_stock_notice' AND NOT tgisinternal)
              THEN 'DONE' ELSE 'TODO' END,
         ''

  UNION ALL
  -- R4: the legacy low-stock trigger + function must be GONE (superseded by the cron).
  SELECT 4, 'R4 legacy low_stock trigger dropped',
         CASE WHEN NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trigger_medication_low_stock')
                AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                                WHERE n.nspname='public' AND p.proname='handle_medication_low_stock_trigger')
              THEN 'DONE' ELSE 'TODO — legacy still present' END,
         ''

  UNION ALL
  -- ── ESCALATION ANCHOR ──────────────────────────────────────────────────
  -- E1: the anchor column both senders stamp on a snooze re-fire.
  SELECT 5, 'E1 reminder_events.last_prompted_at',
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_schema='public' AND table_name='reminder_events'
                             AND column_name='last_prompted_at') THEN 'DONE' ELSE 'TODO' END,
         ''

  UNION ALL
  -- E2: the scanner must actually USE the anchor (its body references last_prompted_at).
  SELECT 6, 'E2 scanner uses last_prompted_at anchor',
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                           WHERE n.nspname='public' AND p.proname='scan_and_escalate_overdue_reminders'
                             AND pg_get_functiondef(p.oid) ILIKE '%last_prompted_at%')
              THEN 'DONE' ELSE 'TODO — old scanner (anchors on scheduled_for)' END,
         ''

  UNION ALL
  -- E3: scanner stays service_role-only (lockdown preserved).
  SELECT 7, 'E3 scanner ACL locked',
         CASE WHEN has_function_privilege('authenticated','public.scan_and_escalate_overdue_reminders()','EXECUTE')
                OR has_function_privilege('anon','public.scan_and_escalate_overdue_reminders()','EXECUTE')
              THEN 'TODO — anon/authenticated can execute' ELSE 'DONE' END,
         'both should be false'

) t ORDER BY ord;
