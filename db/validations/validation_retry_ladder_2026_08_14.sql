-- Validation for migration_retry_ladder_2026_08_14.sql
--
-- ONE query — the editor shows only the last statement's result.
--
-- Checks 4-7 are the ones worth having: they PROVE the cap by trying to break it
-- inside a rolled-back savepoint, rather than reading the constraint's text and
-- assuming it means what it says. A CHECK that is present but wrong looks
-- identical to a correct one in the catalog.
-- ============================================================================

WITH cols AS (
  SELECT
    count(*) FILTER (WHERE column_name = 'retry_interval_minutes') AS has_interval,
    count(*) FILTER (WHERE column_name = 'retry_count')            AS has_count,
    count(*) FILTER (WHERE column_name IN ('retry_interval_minutes','retry_count')
                       AND is_nullable = 'YES')                    AS nullable_both
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'medications'
),
con AS (
  SELECT pg_get_constraintdef(oid) AS def
  FROM pg_constraint
  WHERE conname = 'medications_retry_ladder_within_cap'
    AND conrelid = 'public.medications'::regclass
)

SELECT 1 AS chk, 'both columns exist' AS what,
       (SELECT has_interval + has_count FROM cols)::text AS observed,
       CASE WHEN (SELECT has_interval + has_count FROM cols) = 2 THEN 'DONE' ELSE 'FAIL' END AS verdict

UNION ALL
-- NULL is the normal state: it means "use the priority default", and a NOT NULL
-- here would have forced a backfill that freezes today's defaults into the data.
SELECT 2, 'both are nullable (NULL = use the priority default)',
       (SELECT nullable_both FROM cols)::text,
       CASE WHEN (SELECT nullable_both FROM cols) = 2 THEN 'DONE' ELSE 'FAIL' END

UNION ALL
SELECT 3, 'cap constraint exists',
       coalesce((SELECT def FROM con), '(missing)'),
       CASE WHEN (SELECT count(*) FROM con) = 1 THEN 'DONE' ELSE 'FAIL' END

UNION ALL
-- Nothing was backfilled, so every existing medication still uses its default.
SELECT 4, 'INFO — medications with a custom ladder',
       (SELECT count(*)::text FROM public.medications WHERE retry_interval_minutes IS NOT NULL),
       'INFO'

UNION ALL
SELECT 5, 'no row already violates the cap',
       (SELECT count(*)::text FROM public.medications
        WHERE retry_interval_minutes IS NOT NULL
          AND retry_interval_minutes * retry_count > 30),
       CASE WHEN (SELECT count(*) FROM public.medications
                  WHERE retry_interval_minutes IS NOT NULL
                    AND retry_interval_minutes * retry_count > 30) = 0
            THEN 'DONE' ELSE 'FAIL' END

UNION ALL
SELECT 6, 'no half-configured row (one column set, the other NULL)',
       (SELECT count(*)::text FROM public.medications
        WHERE (retry_interval_minutes IS NULL) <> (retry_count IS NULL)),
       CASE WHEN (SELECT count(*) FROM public.medications
                  WHERE (retry_interval_minutes IS NULL) <> (retry_count IS NULL)) = 0
            THEN 'DONE' ELSE 'FAIL' END

ORDER BY chk;

-- ── CHECK 7, RUN SEPARATELY — prove the cap actually bites ──────────────────
-- Reading the constraint's definition is not the same as knowing it fires. Run
-- this block; it writes nothing (the ROLLBACK is unconditional).
--
-- Expect: the first UPDATE succeeds (5 x 5 = 25, under the cap), the second
-- RAISES check_violation (10 x 4 = 40, over it), and the third RAISES as well
-- (half-configured). If any of them behaves differently, the cap is not real
-- and a critical medication could be configured to out-run its own escalation.
--
--   BEGIN;
--     UPDATE public.medications SET retry_interval_minutes = 5,  retry_count = 5
--      WHERE id = (SELECT id FROM public.medications LIMIT 1);   -- expect: OK
--     UPDATE public.medications SET retry_interval_minutes = 10, retry_count = 4
--      WHERE id = (SELECT id FROM public.medications LIMIT 1);   -- expect: ERROR
--     UPDATE public.medications SET retry_interval_minutes = 5,  retry_count = NULL
--      WHERE id = (SELECT id FROM public.medications LIMIT 1);   -- expect: ERROR
--   ROLLBACK;
