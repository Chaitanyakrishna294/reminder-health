-- migration_medication_enhancements.sql
-- Migration to add Medication Model Enhancements and Inventory Tracking

-- 1. Add new columns to public.medications if they do not exist
ALTER TABLE public.medications
ADD COLUMN IF NOT EXISTS unit_type TEXT NULL CHECK (unit_type IN ('TABLET', 'CAPSULE', 'ML', 'DROP', 'APPLICATION', 'TEASPOON', 'UNIT', 'PATCH', 'INHALATION', 'OTHER')),
ADD COLUMN IF NOT EXISTS dosage_amount NUMERIC NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS current_stock NUMERIC NULL,
ADD COLUMN IF NOT EXISTS stock_threshold NUMERIC NULL,
ADD COLUMN IF NOT EXISTS medication_reason TEXT NULL;

-- 2. Populate default values for existing records
UPDATE public.medications
SET unit_type = 'TABLET'
WHERE unit_type IS NULL;

-- 3. One-way stock sync trigger function (current_stock -> tablet_count)
-- Chosen as source of truth to avoid loops/inconsistencies.
CREATE OR REPLACE FUNCTION public.sync_medication_stock_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.current_stock IS NOT NULL THEN
    NEW.tablet_count := floor(NEW.current_stock)::INTEGER;
  ELSE
    NEW.tablet_count := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_medication_stock_fields ON public.medications;
CREATE TRIGGER trigger_sync_medication_stock_fields
  BEFORE INSERT OR UPDATE ON public.medications
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_medication_stock_fields();

-- 4. Idempotency-protected stock reduction trigger function (non-TAKEN -> TAKEN only)
CREATE OR REPLACE FUNCTION public.handle_reminder_event_taken_stock_reduction()
RETURNS TRIGGER AS $$
DECLARE
  v_dosage_amount NUMERIC;
  v_current_stock NUMERIC;
BEGIN
  IF NEW.reminder_status = 'TAKEN' AND (OLD.reminder_status IS DISTINCT FROM 'TAKEN') THEN
    SELECT dosage_amount, current_stock INTO v_dosage_amount, v_current_stock
    FROM public.medications
    WHERE id = NEW.medication_id;
    
    IF v_current_stock IS NOT NULL AND v_dosage_amount IS NOT NULL THEN
      UPDATE public.medications
      SET current_stock = GREATEST(0, v_current_stock - v_dosage_amount)
      WHERE id = NEW.medication_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_reminder_event_taken_stock_reduction ON public.reminder_events;
CREATE TRIGGER trigger_reminder_event_taken_stock_reduction
  AFTER UPDATE ON public.reminder_events
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_reminder_event_taken_stock_reduction();

-- 5. Deduplicated low stock alert trigger function
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
