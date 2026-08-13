-- Validation for migration_ui_mode_lock_2026_08_13.sql
-- Read-only. Run in the Supabase SQL editor AFTER applying.
-- One UNION ALL query so every row shows at once.

SELECT 1 AS n,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'ui_mode_locked'
  ) THEN 'DONE  1. profiles.ui_mode_locked exists'
    ELSE 'FAIL  1. column missing' END AS result
UNION ALL
SELECT 2,
  CASE WHEN (
    SELECT is_nullable = 'NO' AND column_default LIKE '%false%'
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'ui_mode_locked'
  ) THEN 'DONE  2. NOT NULL DEFAULT false — nobody is locked by the migration itself'
    ELSE 'FAIL  2. nullable or wrong default: ' || COALESCE((
      SELECT is_nullable || ' / ' || COALESCE(column_default, 'no default')
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'ui_mode_locked'
    ), 'column missing') END
UNION ALL
SELECT 3,
  -- Nobody should be locked yet. If this is non-zero straight after applying, the
  -- default was wrong and real users are locked without asking.
  CASE WHEN (SELECT COUNT(*) FROM public.profiles WHERE ui_mode_locked) = 0
    THEN 'DONE  3. 0 profiles locked (expected immediately after applying)'
    ELSE 'INFO  3. ' || (SELECT COUNT(*)::text FROM public.profiles WHERE ui_mode_locked)
         || ' profile(s) locked — fine later, suspicious right now' END
UNION ALL
SELECT 4,
  -- The column is written by the browser, so the own-row UPDATE policy has to exist.
  -- No new policy was added; this asserts the one it rides on is still there.
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'UPDATE'
  ) THEN 'DONE  4. profiles still has an UPDATE policy for the column to ride'
    ELSE 'FAIL  4. no UPDATE policy on profiles — Settings cannot save the lock' END
ORDER BY n;
