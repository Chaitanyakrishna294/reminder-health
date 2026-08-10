-- VALIDATION for migration_dose_days_2026_08_10.sql
-- Run in the Supabase SQL Editor AFTER applying the migration.
-- Every check below should report PASS.

-- 1. Column exists, correct type, nullable (NULL = every day).
SELECT
  CASE
    WHEN data_type = 'ARRAY' AND udt_name = '_int2' AND is_nullable = 'YES'
      THEN 'PASS — dose_days SMALLINT[], nullable'
    ELSE 'FAIL — got ' || data_type || '/' || udt_name || ', nullable=' || is_nullable
  END AS check_1_column
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'medications' AND column_name = 'dose_days';

-- 2. Validity constraint is present.
SELECT
  CASE WHEN count(*) = 1 THEN 'PASS — medications_dose_days_valid present'
       ELSE 'FAIL — constraint missing' END AS check_2_constraint
FROM pg_constraint
WHERE conname = 'medications_dose_days_valid'
  AND conrelid = 'public.medications'::regclass;

-- 3. NO BACKFILL happened — every pre-existing row must still be NULL (daily).
--    A non-zero count here right after applying means something wrote schedules
--    already, which should only be true if the app has been used since.
SELECT
  'INFO — ' || count(*) || ' medication(s) have an explicit dose_days set'
    AS check_3_backfill
FROM public.medications
WHERE dose_days IS NOT NULL;

-- 4. Constraint actually rejects bad data. Each of these must ERROR.
--    Run them ONE AT A TIME; each is expected to fail, which is the pass.
--    (Left commented so this file can be run top-to-bottom without aborting.)
--
--    -- empty array (a medication that is never due):
--    UPDATE public.medications SET dose_days = '{}'   WHERE id = (SELECT min(id) FROM public.medications);
--    -- out of range (7 is not a weekday index):
--    UPDATE public.medications SET dose_days = '{7}'  WHERE id = (SELECT min(id) FROM public.medications);
--    -- negative:
--    UPDATE public.medications SET dose_days = '{-1}' WHERE id = (SELECT min(id) FROM public.medications);
--    -- more than seven entries:
--    UPDATE public.medications SET dose_days = '{0,1,2,3,4,5,6,0}' WHERE id = (SELECT min(id) FROM public.medications);

-- 5. Constraint accepts good data. This must SUCCEED, then be undone.
--    Uncomment, run, confirm no error, then run the reset directly below it.
--
--    UPDATE public.medications SET dose_days = '{1,3,5}' WHERE id = (SELECT min(id) FROM public.medications);
--    UPDATE public.medications SET dose_days = NULL      WHERE id = (SELECT min(id) FROM public.medications);

-- 6. PostgREST can see the column (this is what the medication forms need).
--    If this returns 0 rows the schema cache has not reloaded — re-run
--    NOTIFY pgrst, 'reload schema';
SELECT
  CASE WHEN count(*) = 1 THEN 'PASS — column visible to PostgREST schema cache'
       ELSE 'FAIL — re-run NOTIFY pgrst' END AS check_6_postgrest
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'medications' AND column_name = 'dose_days';
