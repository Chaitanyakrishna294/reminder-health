-- RE-MIND-eЯ Architectural Hardening Migration (2026-06)
-- Resolves verified open issues from problem.md (B1, B2, B5, B7).
-- Idempotent — safe to re-run in the Supabase SQL Editor.
-- ============================================================================


-- ============================================================================
-- B1. Fix close_daily_medications timezone mismatch
-- ----------------------------------------------------------------------------
-- The daily-closure job grouped each dose by its medication's own timezone
-- (m.timezone) when computing the calendar day, but the UPDATE's WHERE clause
-- re-derived that day with a HARDCODED 'Asia/Kolkata'. For any non-IST
-- medication the two dates disagreed, so PENDING_REVIEW/ESCALATED doses never
-- closed on the correct local day. Fix: join medications back into the UPDATE
-- and use the SAME per-medication timezone expression in the WHERE clause.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.close_daily_medications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
BEGIN
  -- Group by patient & scheduled calendar day (in each medication's own timezone).
  -- Once now() exceeds that day's last scheduled dose + 2h, close all of the
  -- patient's still-open events for that day.
  WITH daily_bounds AS (
    SELECT
      re.telegram_id,
      (re.scheduled_for AT TIME ZONE coalesce(nullif(m.timezone, ''), 'Asia/Kolkata'))::date AS scheduled_date,
      MAX(re.scheduled_for) AS max_scheduled_for
    FROM public.reminder_events re
    JOIN public.medications m ON m.id = re.medication_id
    GROUP BY re.telegram_id, (re.scheduled_for AT TIME ZONE coalesce(nullif(m.timezone, ''), 'Asia/Kolkata'))::date
  )
  UPDATE public.reminder_events re
  SET reminder_status = 'UNCONFIRMED'
  FROM daily_bounds db, public.medications m
  WHERE re.telegram_id = db.telegram_id
    AND m.id = re.medication_id
    -- Consistent with the CTE: derive the day in the medication's own timezone,
    -- NOT a hardcoded zone.
    AND (re.scheduled_for AT TIME ZONE coalesce(nullif(m.timezone, ''), 'Asia/Kolkata'))::date = db.scheduled_date
    AND re.reminder_status IN ('PENDING_REVIEW', 'ESCALATED')
    AND v_now >= db.max_scheduled_for + interval '2 hours';
END;
$$;


-- ============================================================================
-- B2. Cross-instance scheduler lock (lease-based)
-- ----------------------------------------------------------------------------
-- The node-cron tick runs every minute with no protection against two
-- overlapping instances (deploy/restart), which can double-escalate overdue
-- reminders. A session-level pg_advisory_lock is unreliable through a
-- connection pooler, so we use a lease row: an atomic conditional UPSERT acts
-- as the mutex and the lease auto-expires if a holder crashes mid-tick.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.scheduler_locks (
  lock_name    text PRIMARY KEY,
  locked_until timestamptz NOT NULL DEFAULT now(),
  holder       text
);

-- Try to acquire (or steal an expired) lease. Returns true iff this caller holds it.
CREATE OR REPLACE FUNCTION public.try_acquire_scheduler_lock(
  p_lock_name   text,
  p_ttl_seconds int,
  p_holder      text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int;
BEGIN
  INSERT INTO public.scheduler_locks AS sl (lock_name, locked_until, holder)
  VALUES (p_lock_name, now() + make_interval(secs => p_ttl_seconds), p_holder)
  ON CONFLICT (lock_name) DO UPDATE
    SET locked_until = excluded.locked_until,
        holder       = excluded.holder
    WHERE sl.locked_until < now();   -- only steal a lease that has expired

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

-- Release early on clean completion so the next tick isn't blocked by the TTL.
CREATE OR REPLACE FUNCTION public.release_scheduler_lock(
  p_lock_name text,
  p_holder    text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.scheduler_locks
  SET locked_until = now()
  WHERE lock_name = p_lock_name
    AND holder = p_holder;   -- never release a lease another instance now holds
END;
$$;


-- ============================================================================
-- B5. link_codes cleanup job
-- ----------------------------------------------------------------------------
-- link_codes have a 15-minute TTL (expires_at) but, unlike trash / stale
-- connection requests, had no cleanup job — unredeemed codes accumulated
-- forever. Mirror the cleanup_expired_trash + pg_cron pattern.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cleanup_expired_link_codes()
RETURNS void AS $$
BEGIN
  DELETE FROM public.link_codes
  WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove duplicate schedule if present (re-runnable)
SELECT cron.unschedule('cleanup-expired-link-codes-job')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cleanup-expired-link-codes-job'
);

-- Hourly is ample for a 15-minute TTL.
SELECT cron.schedule(
  'cleanup-expired-link-codes-job',
  '15 * * * *',
  'SELECT public.cleanup_expired_link_codes()'
);


-- ============================================================================
-- B7. Stock compensating increment on TAKEN revert
-- ----------------------------------------------------------------------------
-- The stock trigger decrements once when a dose newly becomes TAKEN
-- (idempotent), but never restored stock if a TAKEN dose was later reverted to
-- a non-TAKEN state — leaving inventory permanently understated. Add the
-- symmetric compensating increment so decrement/increment stay balanced.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_reminder_event_taken_stock_reduction()
RETURNS TRIGGER AS $$
DECLARE
  v_dosage_amount NUMERIC;
  v_current_stock NUMERIC;
BEGIN
  -- Decrement when a dose newly becomes TAKEN.
  IF NEW.reminder_status = 'TAKEN' AND (OLD.reminder_status IS DISTINCT FROM 'TAKEN') THEN
    SELECT dosage_amount, current_stock INTO v_dosage_amount, v_current_stock
    FROM public.medications
    WHERE id = NEW.medication_id;

    IF v_current_stock IS NOT NULL AND v_dosage_amount IS NOT NULL THEN
      UPDATE public.medications
      SET current_stock = GREATEST(0, v_current_stock - v_dosage_amount)
      WHERE id = NEW.medication_id;
    END IF;

  -- Compensating increment when a previously-TAKEN dose is reverted away from TAKEN.
  ELSIF OLD.reminder_status = 'TAKEN' AND (NEW.reminder_status IS DISTINCT FROM 'TAKEN') THEN
    SELECT dosage_amount, current_stock INTO v_dosage_amount, v_current_stock
    FROM public.medications
    WHERE id = NEW.medication_id;

    IF v_current_stock IS NOT NULL AND v_dosage_amount IS NOT NULL THEN
      UPDATE public.medications
      SET current_stock = v_current_stock + v_dosage_amount
      WHERE id = NEW.medication_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger definition unchanged; recreated for idempotency.
DROP TRIGGER IF EXISTS trigger_reminder_event_taken_stock_reduction ON public.reminder_events;
CREATE TRIGGER trigger_reminder_event_taken_stock_reduction
  AFTER UPDATE ON public.reminder_events
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_reminder_event_taken_stock_reduction();
