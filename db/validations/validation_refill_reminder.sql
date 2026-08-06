-- Paste after migration_refill_reminder.sql. Every row must report PASS.

SELECT 'column exists' AS check,
       CASE WHEN EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='medications'
           AND column_name='low_stock_notified_at'
       ) THEN 'PASS' ELSE 'FAIL' END AS result;

SELECT 'LOW_STOCK accepted by constraint' AS check,
       CASE WHEN pg_get_constraintdef(oid) LIKE '%LOW_STOCK%'
            THEN 'PASS' ELSE 'FAIL' END AS result
FROM pg_constraint WHERE conname = 'notifications_type_check';

SELECT 'pre-existing types still accepted' AS check,
       CASE WHEN pg_get_constraintdef(oid) LIKE '%CARE_CIRCLE_PRIMARY_CHANGED%'
             AND pg_get_constraintdef(oid) LIKE '%UNCONFIRMED%'
            THEN 'PASS' ELSE 'FAIL' END AS result
FROM pg_constraint WHERE conname = 'notifications_type_check';

SELECT 'rearm trigger installed' AS check,
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_trigger
         WHERE tgname = 'trigger_rearm_low_stock_notice' AND NOT tgisinternal
       ) THEN 'PASS' ELSE 'FAIL' END AS result;

SELECT 'legacy low-stock trigger dropped' AS check,
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM pg_trigger
         WHERE tgname = 'trigger_medication_low_stock' AND NOT tgisinternal
       ) THEN 'PASS' ELSE 'FAIL' END AS result;

-- Behavioural: stamping the flag must NOT clear it; raising stock MUST.
DO $$
DECLARE v_id bigint; v_stock numeric; v_flag timestamptz;
BEGIN
  SELECT id, current_stock INTO v_id, v_stock
  FROM public.medications WHERE current_stock IS NOT NULL LIMIT 1;
  IF v_id IS NULL THEN
    RAISE NOTICE 'SKIP behavioural check: no medication with stock tracking';
    RETURN;
  END IF;

  UPDATE public.medications SET low_stock_notified_at = now() WHERE id = v_id;
  SELECT low_stock_notified_at INTO v_flag FROM public.medications WHERE id = v_id;
  IF v_flag IS NULL THEN RAISE EXCEPTION 'FAIL: flag cleared without a stock increase'; END IF;

  UPDATE public.medications SET current_stock = v_stock + 1 WHERE id = v_id;
  SELECT low_stock_notified_at INTO v_flag FROM public.medications WHERE id = v_id;
  IF v_flag IS NOT NULL THEN RAISE EXCEPTION 'FAIL: flag survived a stock increase'; END IF;

  -- restore
  UPDATE public.medications SET current_stock = v_stock WHERE id = v_id;
  RAISE NOTICE 'PASS behavioural re-arm check';
END $$;

-- Behavioural: NULL -> number (inventory tracking toggled off then back on) must
-- also re-arm, not just number -> bigger number.
DO $$
DECLARE v_id bigint; v_stock numeric; v_flag timestamptz;
BEGIN
  SELECT id, current_stock INTO v_id, v_stock
  FROM public.medications WHERE current_stock IS NOT NULL LIMIT 1;
  IF v_id IS NULL THEN
    RAISE NOTICE 'SKIP behavioural check: no medication with stock tracking';
    RETURN;
  END IF;

  UPDATE public.medications SET low_stock_notified_at = now(), current_stock = NULL WHERE id = v_id;
  SELECT low_stock_notified_at INTO v_flag FROM public.medications WHERE id = v_id;
  IF v_flag IS NULL THEN RAISE EXCEPTION 'FAIL: flag cleared by clearing stock to NULL'; END IF;

  UPDATE public.medications SET current_stock = v_stock WHERE id = v_id;
  SELECT low_stock_notified_at INTO v_flag FROM public.medications WHERE id = v_id;
  IF v_flag IS NOT NULL THEN RAISE EXCEPTION 'FAIL: flag survived a NULL -> number stock transition'; END IF;

  RAISE NOTICE 'PASS behavioural NULL -> number re-arm check';
END $$;
