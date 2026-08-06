-- Rollback for migration_refill_reminder.sql.
-- Run the DELETE before restoring the constraint, or the constraint will fail
-- validation against any LOW_STOCK rows already written.

DROP TRIGGER IF EXISTS trigger_rearm_low_stock_notice ON public.medications;
DROP FUNCTION IF EXISTS public.rearm_low_stock_notice();

DELETE FROM public.notifications WHERE type = 'LOW_STOCK';

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
CHECK (type IN (
  'TAKEN', 'SKIPPED', 'MISSED', 'ESCALATED',
  'CARE_CIRCLE_ACCESS_REQUEST',
  'CARE_CIRCLE_ACCESS_GRANTED',
  'CARE_CIRCLE_ACCESS_UPDATED',
  'CARE_CIRCLE_ACCESS_REVOKED',
  'CARE_CIRCLE_PRIMARY_CHANGED',
  'UNCONFIRMED'
));

ALTER TABLE public.medications DROP COLUMN IF EXISTS low_stock_notified_at;
