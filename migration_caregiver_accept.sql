-- Migration: Add connection acceptance flow, update RLS policies, and auto-delete chat logs older than 7 days

-- 1. Add connection_status column to caregiver_info table
ALTER TABLE public.caregiver_info 
ADD COLUMN IF NOT EXISTS connection_status TEXT DEFAULT 'ACCEPTED';

-- 2. Update RLS policies to enforce accepted connection status for caregivers

-- Recreate Caregiver Medications RLS Policy
DROP POLICY IF EXISTS "Caregivers can view patient medications" ON public.medications;
CREATE POLICY "Caregivers can view patient medications" ON public.medications
  FOR SELECT TO authenticated
  USING (
    telegram_id IN (
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND p.role = 'CAREGIVER' AND ci.is_active = true AND ci.connection_status = 'ACCEPTED'
    )
  );

-- Recreate Caregiver Reminder Events RLS Policies
DROP POLICY IF EXISTS "Caregivers view patient events" ON public.reminder_events;
CREATE POLICY "Caregivers view patient events" ON public.reminder_events
  FOR SELECT TO authenticated
  USING (
    telegram_id IN (
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND p.role = 'CAREGIVER' AND ci.is_active = true AND ci.connection_status = 'ACCEPTED'
    )
  );

DROP POLICY IF EXISTS "Caregivers resolve patient events" ON public.reminder_events;
CREATE POLICY "Caregivers resolve patient events" ON public.reminder_events
  FOR UPDATE TO authenticated
  USING (
    telegram_id IN (
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND p.role = 'CAREGIVER' AND ci.is_active = true AND ci.connection_status = 'ACCEPTED'
    )
  );

-- Recreate Caregiver Reminder Logs RLS Policies
DROP POLICY IF EXISTS "Caregivers view patient logs" ON public.reminder_logs;
CREATE POLICY "Caregivers view patient logs" ON public.reminder_logs
  FOR SELECT TO authenticated
  USING (
    telegram_id IN (
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND p.role = 'CAREGIVER' AND ci.is_active = true AND ci.connection_status = 'ACCEPTED'
    )
  );

DROP POLICY IF EXISTS "Caregivers insert patient logs" ON public.reminder_logs;
CREATE POLICY "Caregivers insert patient logs" ON public.reminder_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    telegram_id IN (
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND p.role = 'CAREGIVER' AND ci.is_active = true AND ci.connection_status = 'ACCEPTED'
    )
  );


-- 3. Redefine trigger function to check for connection_status = 'ACCEPTED'
CREATE OR REPLACE FUNCTION handle_reminder_event_state_change()
RETURNS TRIGGER AS $$
DECLARE
  patient_uid UUID;
  caregiver_uid UUID;
  med_name TEXT;
  patient_name TEXT;
  cg_chat_id TEXT;
BEGIN
  -- Get Medication Drug Name
  SELECT drug_name INTO med_name FROM public.medications WHERE id = NEW.medication_id;
  
  -- Find Patient profile UUID
  SELECT id, full_name INTO patient_uid, patient_name FROM public.profiles WHERE telegram_chat_id = NEW.telegram_id AND role = 'PATIENT';

  -- 1. Handle TAKEN
  IF NEW.reminder_status = 'TAKEN' AND (OLD.reminder_status IS NULL OR OLD.reminder_status <> 'TAKEN') THEN
    IF patient_uid IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (patient_uid, 'Medication Taken', 'You successfully took ' || med_name || '.', 'TAKEN');
    END IF;
    
    -- Notify Caregiver if connected and connection accepted
    SELECT caregiver_chat_id INTO cg_chat_id FROM public.caregiver_info WHERE patient_telegram_id = NEW.telegram_id AND is_active = true AND connection_status = 'ACCEPTED' LIMIT 1;
    IF cg_chat_id IS NOT NULL THEN
      SELECT id INTO caregiver_uid FROM public.profiles WHERE telegram_chat_id = cg_chat_id AND role = 'CAREGIVER';
      IF caregiver_uid IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (caregiver_uid, 'Medication Taken', COALESCE(patient_name, 'Patient') || ' took their medication ' || med_name || '.', 'TAKEN');
      END IF;
    END IF;
      
  -- 2. Handle SKIPPED
  ELSIF NEW.reminder_status = 'SKIPPED' AND (OLD.reminder_status IS NULL OR OLD.reminder_status <> 'SKIPPED') THEN
    IF patient_uid IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (patient_uid, 'Medication Skipped', 'You skipped ' || med_name || '.', 'SKIPPED');
    END IF;
    
    -- Notify Caregiver if connected and connection accepted
    SELECT caregiver_chat_id INTO cg_chat_id FROM public.caregiver_info WHERE patient_telegram_id = NEW.telegram_id AND is_active = true AND connection_status = 'ACCEPTED' LIMIT 1;
    IF cg_chat_id IS NOT NULL THEN
      SELECT id INTO caregiver_uid FROM public.profiles WHERE telegram_chat_id = cg_chat_id AND role = 'CAREGIVER';
      IF caregiver_uid IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (caregiver_uid, 'Medication Skipped', COALESCE(patient_name, 'Patient') || ' skipped their medication ' || med_name || '.', 'SKIPPED');
      END IF;
    END IF;

  -- 3. Handle ESCALATED_TO_CG
  ELSIF NEW.reminder_status = 'ESCALATED_TO_CG' AND (OLD.reminder_status IS NULL OR OLD.reminder_status <> 'ESCALATED_TO_CG') THEN
    -- Notify Caregiver directly if connection accepted
    SELECT caregiver_chat_id INTO cg_chat_id FROM public.caregiver_info WHERE patient_telegram_id = NEW.telegram_id AND is_active = true AND connection_status = 'ACCEPTED' LIMIT 1;
    IF cg_chat_id IS NOT NULL THEN
      SELECT id INTO caregiver_uid FROM public.profiles WHERE telegram_chat_id = cg_chat_id AND role = 'CAREGIVER';
      IF caregiver_uid IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (caregiver_uid, '⚠️ Critical Escalation Alert', COALESCE(patient_name, 'Your patient') || ' has missed their scheduled dose of ' || med_name || '. Please verify.', 'ESCALATED');
      END IF;
    END IF;

  -- 4. Handle MISSED (Scheduler timed out caregiver response)
  ELSIF NEW.reminder_status = 'MISSED' AND (OLD.reminder_status IS NULL OR OLD.reminder_status <> 'MISSED') THEN
    IF patient_uid IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (patient_uid, 'Medication Dose Missed', 'You missed a scheduled dose of ' || med_name || '.', 'MISSED');
    END If;
    
    -- Notify Caregiver if connected and connection accepted
    SELECT caregiver_chat_id INTO cg_chat_id FROM public.caregiver_info WHERE patient_telegram_id = NEW.telegram_id AND is_active = true AND connection_status = 'ACCEPTED' LIMIT 1;
    IF cg_chat_id IS NOT NULL THEN
      SELECT id INTO caregiver_uid FROM public.profiles WHERE telegram_chat_id = cg_chat_id AND role = 'CAREGIVER';
      IF caregiver_uid IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (caregiver_uid, 'Dose Confirmed Missed', COALESCE(patient_name, 'Patient') || ' completely missed their medication ' || med_name || '.', 'MISSED');
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- 4. Create helper trigger function to clean up chat messages older than 7 days
CREATE OR REPLACE FUNCTION public.clean_old_chat_messages()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM public.chat_messages
    WHERE created_at < NOW() - INTERVAL '7 days';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Set up the trigger to run cleanups automatically after every new message insertion
DROP TRIGGER IF EXISTS trg_clean_old_chat_messages ON public.chat_messages;
CREATE TRIGGER trg_clean_old_chat_messages
AFTER INSERT ON public.chat_messages
EXECUTE FUNCTION public.clean_old_chat_messages();
