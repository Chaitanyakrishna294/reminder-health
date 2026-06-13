-- migration_optional_telegram.sql
-- 1. Update trigger handle_new_user to assign synthetic IDs ('WEB-' || NEW.id) to profiles.telegram_chat_id
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name, telegram_chat_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'role', 'PATIENT'),
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'User'),
    'WEB-' || NEW.id::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Migrate any existing profiles that have NULL telegram_chat_id
UPDATE public.profiles 
SET telegram_chat_id = 'WEB-' || id::text 
WHERE telegram_chat_id IS NULL;

-- 3. Clean up orphaned caregiver records and drop/recreate foreign key constraint with ON UPDATE CASCADE
DELETE FROM public.caregiver_info 
WHERE caregiver_chat_id NOT IN (SELECT telegram_chat_id FROM public.profiles WHERE telegram_chat_id IS NOT NULL);

ALTER TABLE public.caregiver_info 
  DROP CONSTRAINT IF EXISTS caregiver_info_caregiver_chat_id_fkey;

ALTER TABLE public.caregiver_info 
  ADD CONSTRAINT caregiver_info_caregiver_chat_id_fkey 
  FOREIGN KEY (caregiver_chat_id) 
  REFERENCES public.profiles(telegram_chat_id) 
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Create function and AFTER UPDATE trigger on profiles to cascade updates from synthetic IDs to other tables
CREATE OR REPLACE FUNCTION public.handle_profile_telegram_chat_id_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.telegram_chat_id IS DISTINCT FROM NEW.telegram_chat_id AND NEW.telegram_chat_id IS NOT NULL THEN
    -- Update medications
    UPDATE public.medications 
    SET telegram_id = NEW.telegram_chat_id 
    WHERE telegram_id = OLD.telegram_chat_id;
    
    -- Update reminder_events
    UPDATE public.reminder_events 
    SET telegram_id = NEW.telegram_chat_id 
    WHERE telegram_id = OLD.telegram_chat_id;
    
    -- Update reminder_logs
    UPDATE public.reminder_logs 
    SET telegram_id = NEW.telegram_chat_id 
    WHERE telegram_id = OLD.telegram_chat_id;
    
    -- Update caregiver_info patient
    UPDATE public.caregiver_info 
    SET patient_telegram_id = NEW.telegram_chat_id 
    WHERE patient_telegram_id = OLD.telegram_chat_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_profile_telegram_chat_id_update ON public.profiles;

CREATE TRIGGER trigger_profile_telegram_chat_id_update
  AFTER UPDATE OF telegram_chat_id ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_profile_telegram_chat_id_update();
