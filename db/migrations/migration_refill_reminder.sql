-- ============================================================================
-- Refill reminder: threshold-based low-stock alerting
-- Spec: docs/superpowers/specs/2026-08-06-refill-reminder-design.md
--
-- 1. medications.low_stock_notified_at  — one alert per crossing, not one a day
-- 2. notifications 'LOW_STOCK' type     — the in-app bell row
-- 3. Drop legacy trigger_medication_low_stock — the cron now owns this alone
-- 4. rearm_low_stock_notice()           — clears the flag when stock goes back up
-- Idempotent; safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Suppression flag
-- Threshold alerts fire far earlier than the old 3-day rule, so without this a
-- threshold of 10 on a once-daily medication would be 10 consecutive identical
-- pushes — and people who are nagged stop reading.
-- ----------------------------------------------------------------------------
ALTER TABLE public.medications
  ADD COLUMN IF NOT EXISTS low_stock_notified_at timestamptz;

COMMENT ON COLUMN public.medications.low_stock_notified_at IS
  'Set by the 09:00 low-stock cron when a refill alert is sent. Cleared by '
  'rearm_low_stock_notice() on any stock increase. NULL means "eligible to alert".';

-- ----------------------------------------------------------------------------
-- 2. In-app notification type
-- Full list carried forward from migration_5.7b_escalation_outcomes_ddl.sql
-- (applied 2026-06-13, entry 27 in APPLIED.md) plus LOW_STOCK.
-- ----------------------------------------------------------------------------
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
CHECK (type IN (
  'TAKEN', 'SKIPPED', 'MISSED', 'ESCALATED',
  'CARE_CIRCLE_ACCESS_REQUEST',
  'CARE_CIRCLE_ACCESS_GRANTED',
  'CARE_CIRCLE_ACCESS_UPDATED',
  'CARE_CIRCLE_ACCESS_REVOKED',
  'CARE_CIRCLE_PRIMARY_CHANGED',
  'UNCONFIRMED',
  'LOW_STOCK'
));

-- ----------------------------------------------------------------------------
-- 3. Drop the legacy low-stock trigger
--
-- migration_medication_enhancements.sql (entry 19, 2026-06-12) installed a
-- fourth, undocumented definition of "low stock": trigger_medication_low_stock
-- fired AFTER INSERT OR UPDATE ON medications whenever current_stock crossed
-- at-or-below stock_threshold, and wrote a notifications row typed 'ESCALATED'
-- titled 'Low Stock Alert'. The 09:00 cron this migration builds toward is now
-- the single owner of every low-stock channel — Telegram, web push, and this
-- same in-app bell — so the trigger is redundant at best and actively wrong at
-- worst: 'ESCALATED' renders as a pulsing danger-red alert in
-- notification-center.tsx, a treatment the design system reserves for a missed
-- dose, not a low-stock warning (which should read 'warning' amber). The
-- instant-on-write feel the trigger provided is already covered by the
-- dashboard strip and med-due gate, which both read live stock on app open.
--
-- This supersedes migration_medication_enhancements.sql rather than editing
-- it — see this repo's "latest file wins" convention in APPLIED.md.
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trigger_medication_low_stock ON public.medications;
DROP FUNCTION IF EXISTS public.handle_medication_low_stock_trigger();

-- ----------------------------------------------------------------------------
-- 4. Re-arm on restock, or on re-enabling alerts
--
-- Two ways a medication must become "eligible to alert" again:
--
-- a) Stock increased. Deliberately "stock increased", NOT "crossed back above
--    stock_threshold". An alert raised by the 3-days-left backup has no threshold
--    to cross back over, and expressing that condition here would mean duplicating
--    the dosesPerDay burn-rate math in SQL, where it cannot be unit-tested. "You
--    bought more, so you are eligible to be warned again next time you get low" is
--    also simply correct: someone who tops up by one tablet and is still low
--    SHOULD hear again tomorrow. This also covers NULL -> number (inventory
--    tracking turned off then back on, per form-logic.ts, which writes
--    current_stock: null while enableInventory is false): a fresh stock count is
--    exactly as much "you now have more than you had" as any other increase, and
--    without treating NULL as "less than any number" here, a medication that had
--    inventory toggled off and on again would carry a stale flag forever, silently
--    excluded from the 09:00 cron's `.is('low_stock_notified_at', null)` filter.
--
-- b) Alerts re-enabled. A patient who turns low-stock warnings back on (the bot's
--    "Stop Reminders" button only flips low_stock_alert_enabled to false, leaving
--    any existing stamp in place) is explicitly asking to be warned again — that
--    request must not be silently defeated by a flag left over from before they
--    turned alerts off.
--
-- BEFORE UPDATE (not AFTER) so it mutates NEW in place — an AFTER trigger issuing
-- its own UPDATE on medications would recurse.
--
-- Note this does not fire when the cron stamps low_stock_notified_at, because that
-- write does not change current_stock or low_stock_alert_enabled.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rearm_low_stock_notice()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.current_stock IS NOT NULL
      AND (OLD.current_stock IS NULL OR NEW.current_stock > OLD.current_stock))
     OR (COALESCE(NEW.low_stock_alert_enabled, false)
         AND NOT COALESCE(OLD.low_stock_alert_enabled, false)) THEN
    NEW.low_stock_notified_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_rearm_low_stock_notice ON public.medications;
CREATE TRIGGER trigger_rearm_low_stock_notice
  BEFORE UPDATE ON public.medications
  FOR EACH ROW
  EXECUTE FUNCTION public.rearm_low_stock_notice();
