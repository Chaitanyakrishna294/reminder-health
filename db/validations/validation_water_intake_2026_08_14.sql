-- Validation for migration_water_intake_2026_08_14.sql
-- Read-only. Run in the Supabase SQL editor AFTER applying.

SELECT 1 AS n,
  CASE WHEN (SELECT COUNT(*) FROM information_schema.tables
             WHERE table_schema='public' AND table_name IN ('water_settings','water_logs')) = 2
    THEN 'DONE  1. both tables exist'
    ELSE 'FAIL  1. one or both tables missing' END AS result
UNION ALL
SELECT 2,
  -- RLS is the only real defence here (CLAUDE.md): the anon key ships inside the
  -- APK and anyone can unpack it.
  CASE WHEN (SELECT bool_and(relrowsecurity) FROM pg_class
             WHERE relnamespace='public'::regnamespace AND relname IN ('water_settings','water_logs'))
    THEN 'DONE  2. RLS enabled on both'
    ELSE 'FAIL  2. RLS is OFF on at least one — every row is world-readable' END
UNION ALL
SELECT 3,
  CASE WHEN (SELECT COUNT(*) FROM pg_policies
             WHERE schemaname='public' AND tablename IN ('water_settings','water_logs')) = 2
    THEN 'DONE  3. exactly one own-row policy each'
    ELSE 'INFO  3. ' || (SELECT COUNT(*)::text FROM pg_policies
                         WHERE schemaname='public' AND tablename IN ('water_settings','water_logs'))
         || ' policies — more than two means an overlapping grant; check them by hand '
            '(a UNION of policies grants if EITHER matches, which is how the caregiver dual-read happened)' END
UNION ALL
SELECT 4,
  -- The APK's key must reach neither table.
  CASE WHEN NOT (
    has_table_privilege('anon','public.water_settings','SELECT') OR
    has_table_privilege('anon','public.water_logs','SELECT')
  ) THEN 'DONE  4. anon has no SELECT on either table'
    ELSE 'FAIL  4. anon can read hydration data — the APK ships that key' END
UNION ALL
SELECT 5,
  CASE WHEN (SELECT column_default FROM information_schema.columns
             WHERE table_schema='public' AND table_name='water_settings' AND column_name='enabled') LIKE '%false%'
    THEN 'DONE  5. enabled DEFAULT false — nobody gets this feature without asking'
    ELSE 'FAIL  5. wrong default; the migration would switch it on for everyone' END
UNION ALL
SELECT 6,
  CASE WHEN (SELECT COUNT(*) FROM pg_constraint
             WHERE conrelid='public.water_settings'::regclass AND contype='c') >= 4
    THEN 'DONE  6. input rails present on water_settings'
    ELSE 'FAIL  6. missing CHECKs — a typo could store a 90-cup day' END
UNION ALL
SELECT 7,
  CASE WHEN EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid='public.water_logs'::regclass AND conname='water_logs_cups_sane')
    THEN 'DONE  7. water_logs cup count is bounded (0-60)'
    ELSE 'FAIL  7. no bound — undo on an empty day could store a negative count' END
UNION ALL
SELECT 8,
  -- Deleting an account must take this with it. These tables are keyed on
  -- auth.users and would otherwise outlive the person.
  CASE WHEN (SELECT COUNT(*) FROM pg_constraint
             WHERE conrelid IN ('public.water_settings'::regclass,'public.water_logs'::regclass)
               AND contype='f' AND confdeltype='c') = 2
    THEN 'DONE  8. both cascade on account deletion'
    ELSE 'FAIL  8. an FK is not ON DELETE CASCADE — rows would outlive the account' END
ORDER BY n;

-- Check 9 (run separately — it must RAISE): the rails are real.
--   INSERT INTO public.water_settings (user_id, goal_cups) VALUES (auth.uid(), 99);
--   -- expect: ERROR 23514 violates check constraint "water_settings_goal_sane"
