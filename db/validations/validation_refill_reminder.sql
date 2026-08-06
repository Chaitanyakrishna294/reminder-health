-- Validation for migration_refill_reminder.sql.
--
-- RUN PART 1 AND PART 2 SEPARATELY. The Supabase SQL editor only displays the result
-- of the LAST statement in a batch, so the previous version of this file — five
-- standalone SELECTs — silently showed one row and hid the other four. Part 1 is now a
-- single UNION ALL query, so every structural check lands in one grid.

-- ============================================================================
-- PART 1 — structural checks. Paste this block alone. All five rows must say PASS.
-- ============================================================================
SELECT * FROM (
  SELECT 1 AS ord, 'column low_stock_notified_at exists' AS check,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='medications'
             AND column_name='low_stock_notified_at'
         ) THEN 'PASS' ELSE 'FAIL' END AS result

  UNION ALL
  SELECT 2, 'LOW_STOCK accepted by notifications constraint',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname='notifications_type_check'
             AND pg_get_constraintdef(oid) LIKE '%LOW_STOCK%'
         ) THEN 'PASS' ELSE 'FAIL' END

  -- Guards the real risk in rewriting a CHECK: silently dropping a value that an
  -- existing notification path still writes.
  UNION ALL
  SELECT 3, 'pre-existing notification types still accepted',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname='notifications_type_check'
             AND pg_get_constraintdef(oid) LIKE '%CARE_CIRCLE_PRIMARY_CHANGED%'
             AND pg_get_constraintdef(oid) LIKE '%UNCONFIRMED%'
             AND pg_get_constraintdef(oid) LIKE '%ESCALATED%'
         ) THEN 'PASS' ELSE 'FAIL' END

  UNION ALL
  SELECT 4, 'rearm trigger installed',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_trigger
           WHERE tgname='trigger_rearm_low_stock_notice' AND NOT tgisinternal
         ) THEN 'PASS' ELSE 'FAIL' END

  UNION ALL
  SELECT 5, 'legacy low-stock trigger dropped',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM pg_trigger
           WHERE tgname='trigger_medication_low_stock' AND NOT tgisinternal
         ) THEN 'PASS' ELSE 'FAIL' END
) t ORDER BY ord;


-- ============================================================================
-- PART 2 — behavioural checks for the re-arm trigger. Paste this block alone.
-- Results appear in the editor's MESSAGES / NOTICES pane, not the results grid.
--
-- This mutates a real medication row and restores it. Every mutation is inside a
-- single DO block, which Postgres runs atomically — if any check fails, the whole
-- block rolls back and the row is left exactly as found. The EXCEPTION handler
-- exists so a failure still reports which check failed rather than a bare abort.
-- ============================================================================
DO $$
DECLARE
  v_id bigint; v_stock numeric; v_flag timestamptz; v_fail text;
BEGIN
  SELECT id, current_stock INTO v_id, v_stock
  FROM public.medications WHERE current_stock IS NOT NULL LIMIT 1;

  IF v_id IS NULL THEN
    RAISE NOTICE 'SKIP: no medication with stock tracking to test against';
    RETURN;
  END IF;
  RAISE NOTICE 'Testing against medication id %, current_stock %', v_id, v_stock;

  -- 1. Stamping the flag must NOT clear it (the cron's own write must survive).
  UPDATE public.medications SET low_stock_notified_at = now() WHERE id = v_id;
  SELECT low_stock_notified_at INTO v_flag FROM public.medications WHERE id = v_id;
  IF v_flag IS NULL THEN v_fail := 'flag cleared by the cron stamp itself'; RAISE EXCEPTION 'x'; END IF;
  RAISE NOTICE 'PASS 1/3: stamp survives';

  -- 2. Any stock INCREASE must re-arm.
  UPDATE public.medications SET current_stock = v_stock + 1 WHERE id = v_id;
  SELECT low_stock_notified_at INTO v_flag FROM public.medications WHERE id = v_id;
  IF v_flag IS NOT NULL THEN v_fail := 'flag survived a stock increase'; RAISE EXCEPTION 'x'; END IF;
  RAISE NOTICE 'PASS 2/3: stock increase re-arms';

  -- 3. NULL -> number must re-arm too. This is the dead-end the pre-merge review
  --    caught: form-logic.ts writes current_stock = NULL when inventory tracking is
  --    switched off, so without this the medication could never be alerted again.
  UPDATE public.medications SET low_stock_notified_at = now(), current_stock = NULL WHERE id = v_id;
  SELECT low_stock_notified_at INTO v_flag FROM public.medications WHERE id = v_id;
  IF v_flag IS NULL THEN v_fail := 'flag cleared merely by setting stock to NULL'; RAISE EXCEPTION 'x'; END IF;

  UPDATE public.medications SET current_stock = v_stock WHERE id = v_id;
  SELECT low_stock_notified_at INTO v_flag FROM public.medications WHERE id = v_id;
  IF v_flag IS NOT NULL THEN v_fail := 'flag survived a NULL -> number transition'; RAISE EXCEPTION 'x'; END IF;
  RAISE NOTICE 'PASS 3/3: NULL -> number re-arms';

  -- Leave the row as found.
  UPDATE public.medications
     SET current_stock = v_stock, low_stock_notified_at = NULL
   WHERE id = v_id;
  RAISE NOTICE 'ALL BEHAVIOURAL CHECKS PASSED (medication id % restored to stock %)', v_id, v_stock;

EXCEPTION WHEN OTHERS THEN
  -- The block rolls back on its own; this only makes the reason legible.
  RAISE EXCEPTION 'BEHAVIOURAL CHECK FAILED: %. All changes rolled back.',
    COALESCE(v_fail, SQLERRM);
END $$;
