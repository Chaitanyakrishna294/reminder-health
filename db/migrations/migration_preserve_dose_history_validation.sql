-- Validation for migration_preserve_dose_history.sql
--
-- Run as ONE statement. The Supabase SQL editor only shows the result of the last
-- statement in a batch, so separate SELECTs would silently hide all but the final row.

SELECT 'reminder_logs FK is SET NULL' AS check,
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint c
          WHERE c.conrelid = 'public.reminder_logs'::regclass
            AND c.contype = 'f' AND c.confdeltype = 'n'
       ) THEN 'PASS' ELSE 'FAIL' END AS result

UNION ALL SELECT 'reminder_events FK is SET NULL',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint c
          WHERE c.conrelid = 'public.reminder_events'::regclass
            AND c.contype = 'f' AND c.confdeltype = 'n'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL SELECT 'no CASCADE left on either table',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM pg_constraint c
          WHERE c.conrelid IN ('public.reminder_logs'::regclass, 'public.reminder_events'::regclass)
            AND c.contype = 'f' AND c.confdeltype = 'c'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL SELECT 'snapshot columns exist',
       CASE WHEN (
         SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name IN ('reminder_logs','reminder_events')
            AND column_name = 'drug_name_snapshot'
       ) = 2 THEN 'PASS' ELSE 'FAIL' END

UNION ALL SELECT 'insert triggers installed',
       CASE WHEN (
         SELECT count(*) FROM pg_trigger
          WHERE NOT tgisinternal
            AND tgname IN ('trg_reminder_logs_snapshot','trg_reminder_events_snapshot')
       ) = 2 THEN 'PASS' ELSE 'FAIL' END

UNION ALL SELECT 'existing history backfilled',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM public.reminder_logs l
           JOIN public.medications m ON m.id = l.medication_id
          WHERE l.drug_name_snapshot IS NULL
       ) THEN 'PASS' ELSE 'FAIL' END;
