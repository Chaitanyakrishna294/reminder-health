-- Rollback for migration_refill_reminder.sql.
-- Run the DELETE before restoring the constraint, or the constraint will fail
-- validation against any LOW_STOCK rows already written.

DROP TRIGGER IF EXISTS trigger_rearm_low_stock_notice ON public.medications;
DROP FUNCTION IF EXISTS public.rearm_low_stock_notice();

-- Restore the legacy low-stock trigger the migration dropped (section 3).
-- Function body copied verbatim from migration_medication_enhancements.sql
-- (entry 19, 2026-06-12) — this is the only place its definition lives now
-- that the migration has dropped it.
CREATE OR REPLACE FUNCTION public.handle_medication_low_stock_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF NEW.current_stock IS NOT NULL AND NEW.stock_threshold IS NOT NULL THEN
    -- Alert deduplication: trigger only when crossing the threshold from above or when first initialized
    IF NEW.current_stock <= NEW.stock_threshold AND
       (OLD.current_stock IS NULL OR OLD.current_stock > NEW.stock_threshold OR OLD.stock_threshold IS NULL) THEN

      SELECT id INTO v_user_id
      FROM public.profiles
      WHERE telegram_chat_id = NEW.telegram_id
      LIMIT 1;

      IF v_user_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          v_user_id,
          '⚠️ Low Stock Alert',
          'Only ' || NEW.current_stock || ' ' || COALESCE(NEW.unit_type, 'units') || ' remaining for ' || NEW.drug_name || '.',
          'ESCALATED'
        );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_medication_low_stock ON public.medications;
CREATE TRIGGER trigger_medication_low_stock
  AFTER INSERT OR UPDATE ON public.medications
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_medication_low_stock_trigger();

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
