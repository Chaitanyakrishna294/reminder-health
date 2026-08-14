-- Validation for migration_alarm_ring_seconds_2026_08_14.sql
-- Read-only. Run in the Supabase SQL editor AFTER applying.
-- One UNION ALL query so every row shows at once.

SELECT 1 AS n,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'alarm_ring_seconds'
  ) THEN 'DONE  1. profiles.alarm_ring_seconds exists'
    ELSE 'FAIL  1. column missing' END AS result
UNION ALL
SELECT 2,
  CASE WHEN (
    SELECT is_nullable = 'NO' AND column_default LIKE '%60%'
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'alarm_ring_seconds'
  ) THEN 'DONE  2. NOT NULL DEFAULT 60 — the migration changes nobody''s alarm'
    ELSE 'FAIL  2. nullable or wrong default: ' || COALESCE((
      SELECT is_nullable || ' / ' || COALESCE(column_default, 'no default')
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'alarm_ring_seconds'
    ), 'column missing') END
UNION ALL
SELECT 3,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_alarm_ring_seconds_bounds'
  ) THEN 'DONE  3. bounds CHECK present (a form check is advice; this is the limit)'
    ELSE 'FAIL  3. no CHECK — any value the client sends would be stored' END
UNION ALL
SELECT 4,
  -- Every existing row must be inside the bounds, or the CHECK did not actually
  -- apply to them. NOT VALID constraints pass check 3 and fail here.
  CASE WHEN (
    SELECT COUNT(*) FROM public.profiles
    WHERE alarm_ring_seconds < 60 OR alarm_ring_seconds > 300
  ) = 0
    THEN 'DONE  4. every profile is within 60-300s'
    ELSE 'FAIL  4. ' || (
      SELECT COUNT(*)::text FROM public.profiles
      WHERE alarm_ring_seconds < 60 OR alarm_ring_seconds > 300
    ) || ' profile(s) outside the bounds — the CHECK is NOT VALID or was skipped' END
UNION ALL
SELECT 5,
  -- Everyone should still be on the default right after applying. A non-default
  -- value here means the column already existed with other data, which changes
  -- what this migration is doing.
  CASE WHEN (SELECT COUNT(*) FROM public.profiles WHERE alarm_ring_seconds <> 60) = 0
    THEN 'DONE  5. all profiles at 60s (expected immediately after applying)'
    ELSE 'INFO  5. ' || (SELECT COUNT(*)::text FROM public.profiles WHERE alarm_ring_seconds <> 60)
         || ' profile(s) already customised — fine later, suspicious right now' END
UNION ALL
SELECT 6,
  -- The column is written by the browser, so the own-row UPDATE policy has to exist.
  -- No new policy was added; this asserts the one it rides on is still there.
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'UPDATE'
  ) THEN 'DONE  6. profiles still has an UPDATE policy for the column to ride'
    ELSE 'FAIL  6. no UPDATE policy on profiles — Settings cannot save the duration' END
ORDER BY n;

-- Check 7 (run separately — it must RAISE, so it cannot live in the UNION):
-- the bounds are real, not decorative. Expect ERROR 23514.
--
--   UPDATE public.profiles SET alarm_ring_seconds = 30 WHERE id = auth.uid();
--   -- expect: new row for relation "profiles" violates check constraint
--   --         "profiles_alarm_ring_seconds_bounds"
--
-- 30s would be a dose alarm that gives up before someone in another room reaches
-- the phone. If this UPDATE succeeds, roll back rather than ship it.
