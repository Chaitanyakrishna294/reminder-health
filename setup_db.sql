-- SETUP DATABASE SCRIPT FOR RE-MIND-eЯ V1 WEB DASHBOARD
-- Run this in your Supabase SQL Editor

-- 1. Profiles Table to link Web Users with Telegram
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('PATIENT', 'CAREGIVER')),
  full_name TEXT,
  telegram_chat_id TEXT UNIQUE, -- Matches telegram_id on medications and chat_id on caregiver_info
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on Profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 2. Link Codes Table for Secure Account Connection
CREATE TABLE IF NOT EXISTS public.link_codes (
  id BIGSERIAL PRIMARY KEY,
  telegram_chat_id TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '15 minutes')
);

-- Enable RLS on Link Codes
ALTER TABLE public.link_codes ENABLE ROW LEVEL SECURITY;

-- 3. Notifications Table (In-app Realtime alerts)
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('TAKEN', 'SKIPPED', 'MISSED', 'ESCALATED')),
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on Notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 4. Trigger: Automatically insert profile when a new user signs up in Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name, telegram_chat_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'role', 'PATIENT'),
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'User'),
    NULL
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5. Trigger: Automatically generate notifications on reminder_events state changes
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
    
    -- Notify Caregiver if connected
    SELECT caregiver_chat_id INTO cg_chat_id FROM public.caregiver_info WHERE patient_telegram_id = NEW.telegram_id AND is_active = true LIMIT 1;
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
    
    -- Notify Caregiver if connected
    SELECT caregiver_chat_id INTO cg_chat_id FROM public.caregiver_info WHERE patient_telegram_id = NEW.telegram_id AND is_active = true LIMIT 1;
    IF cg_chat_id IS NOT NULL THEN
      SELECT id INTO caregiver_uid FROM public.profiles WHERE telegram_chat_id = cg_chat_id AND role = 'CAREGIVER';
      IF caregiver_uid IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (caregiver_uid, 'Medication Skipped', COALESCE(patient_name, 'Patient') || ' skipped their medication ' || med_name || '.', 'SKIPPED');
      END IF;
    END IF;

  -- 3. Handle ESCALATED_TO_CG
  ELSIF NEW.reminder_status = 'ESCALATED_TO_CG' AND (OLD.reminder_status IS NULL OR OLD.reminder_status <> 'ESCALATED_TO_CG') THEN
    -- Notify Caregiver directly
    SELECT caregiver_chat_id INTO cg_chat_id FROM public.caregiver_info WHERE patient_telegram_id = NEW.telegram_id AND is_active = true LIMIT 1;
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
    END IF;
    
    -- Notify Caregiver if connected
    SELECT caregiver_chat_id INTO cg_chat_id FROM public.caregiver_info WHERE patient_telegram_id = NEW.telegram_id AND is_active = true LIMIT 1;
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

CREATE OR REPLACE TRIGGER trigger_reminder_event_state_change
AFTER INSERT OR UPDATE ON public.reminder_events
FOR EACH ROW EXECUTE FUNCTION handle_reminder_event_state_change();

-- 6. Row Level Security Policies
-- Profiles
CREATE POLICY "Allow users to read their own profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "Allow users to update their own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Link Codes
CREATE POLICY "Allow code verification by authenticated users" ON public.link_codes
  FOR ALL TO authenticated USING (true);

-- Medications
CREATE POLICY "Patients can manage their medications" ON public.medications
  FOR ALL TO authenticated USING (
    telegram_id IN (SELECT telegram_chat_id FROM public.profiles WHERE id = auth.uid() AND role = 'PATIENT')
  );

CREATE POLICY "Caregivers can view patient medications" ON public.medications
  FOR SELECT TO authenticated USING (
    telegram_id IN (
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND p.role = 'CAREGIVER' AND ci.is_active = true
    )
  );

-- Reminder Events
CREATE POLICY "Patients view own events" ON public.reminder_events
  FOR SELECT TO authenticated USING (
    telegram_id IN (SELECT telegram_chat_id FROM public.profiles WHERE id = auth.uid() AND role = 'PATIENT')
  );

CREATE POLICY "Caregivers view patient events" ON public.reminder_events
  FOR SELECT TO authenticated USING (
    telegram_id IN (
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND p.role = 'CAREGIVER' AND ci.is_active = true
    )
  );

-- Notifications
CREATE POLICY "Users manage their own notifications" ON public.notifications
  FOR ALL TO authenticated USING (user_id = auth.uid());

-- Reminder Events (Update policies)
CREATE POLICY "Patients resolve own events" ON public.reminder_events
  FOR UPDATE TO authenticated 
  USING (telegram_id IN (SELECT telegram_chat_id FROM public.profiles WHERE id = auth.uid() AND role = 'PATIENT'))
  WITH CHECK (telegram_id IN (SELECT telegram_chat_id FROM public.profiles WHERE id = auth.uid() AND role = 'PATIENT'));

CREATE POLICY "Caregivers resolve patient events" ON public.reminder_events
  FOR UPDATE TO authenticated 
  USING (
    telegram_id IN (
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND p.role = 'CAREGIVER' AND ci.is_active = true
    )
  );

-- Reminder Logs Policies
ALTER TABLE public.reminder_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Patients view own logs" ON public.reminder_logs
  FOR SELECT TO authenticated USING (
    telegram_id IN (SELECT telegram_chat_id FROM public.profiles WHERE id = auth.uid() AND role = 'PATIENT')
  );

CREATE POLICY "Caregivers view patient logs" ON public.reminder_logs
  FOR SELECT TO authenticated USING (
    telegram_id IN (
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND p.role = 'CAREGIVER' AND ci.is_active = true
    )
  );

CREATE POLICY "Patients insert own logs" ON public.reminder_logs
  FOR INSERT TO authenticated WITH CHECK (
    telegram_id IN (SELECT telegram_chat_id FROM public.profiles WHERE id = auth.uid() AND role = 'PATIENT')
  );

CREATE POLICY "Caregivers insert patient logs" ON public.reminder_logs
  FOR INSERT TO authenticated WITH CHECK (
    telegram_id IN (
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND p.role = 'CAREGIVER' AND ci.is_active = true
    )
  );

