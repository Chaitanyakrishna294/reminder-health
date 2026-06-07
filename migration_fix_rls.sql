-- 1. FIX MEDICATIONS RLS POLICIES
DROP POLICY IF EXISTS "Patients can manage their medications" ON public.medications;
DROP POLICY IF EXISTS "Users can manage their own medications" ON public.medications;
DROP POLICY IF EXISTS "Caregivers can view patient medications" ON public.medications;

-- Allow all authenticated users (both patients and caregivers) to view and manage their own medications
CREATE POLICY "Users can manage their own medications" ON public.medications
  FOR ALL TO authenticated
  USING (telegram_id IN (SELECT telegram_chat_id FROM public.profiles WHERE id = auth.uid()));

-- Allow caregivers to view their linked patients' medications (read-only SELECT)
CREATE POLICY "Caregivers can view patient medications" ON public.medications
  FOR SELECT TO authenticated
  USING (
    telegram_id IN (
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND p.role = 'CAREGIVER' AND ci.is_active = true
    )
  );


-- 2. FIX REMINDER EVENTS RLS POLICIES
DROP POLICY IF EXISTS "Patients view own events" ON public.reminder_events;
DROP POLICY IF EXISTS "Users view own events" ON public.reminder_events;
DROP POLICY IF EXISTS "Caregivers view patient events" ON public.reminder_events;
DROP POLICY IF EXISTS "Patients resolve own events" ON public.reminder_events;
DROP POLICY IF EXISTS "Users resolve own events" ON public.reminder_events;
DROP POLICY IF EXISTS "Caregivers resolve patient events" ON public.reminder_events;

-- Allow users to view their own reminder events
CREATE POLICY "Users view own events" ON public.reminder_events
  FOR SELECT TO authenticated
  USING (telegram_id IN (SELECT telegram_chat_id FROM public.profiles WHERE id = auth.uid()));

-- Allow caregivers to view their patient's reminder events
CREATE POLICY "Caregivers view patient events" ON public.reminder_events
  FOR SELECT TO authenticated
  USING (
    telegram_id IN (
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND p.role = 'CAREGIVER' AND ci.is_active = true
    )
  );

-- Allow users to update/resolve their own reminder events
CREATE POLICY "Users resolve own events" ON public.reminder_events
  FOR UPDATE TO authenticated
  USING (telegram_id IN (SELECT telegram_chat_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (telegram_id IN (SELECT telegram_chat_id FROM public.profiles WHERE id = auth.uid()));

-- Allow caregivers to resolve their patient's reminder events
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


-- 3. FIX REMINDER LOGS RLS POLICIES
DROP POLICY IF EXISTS "Patients view own logs" ON public.reminder_logs;
DROP POLICY IF EXISTS "Users view own logs" ON public.reminder_logs;
DROP POLICY IF EXISTS "Caregivers view patient logs" ON public.reminder_logs;
DROP POLICY IF EXISTS "Patients insert own logs" ON public.reminder_logs;
DROP POLICY IF EXISTS "Users insert own logs" ON public.reminder_logs;
DROP POLICY IF EXISTS "Caregivers insert patient logs" ON public.reminder_logs;

-- Allow users to view their own reminder logs
CREATE POLICY "Users view own logs" ON public.reminder_logs
  FOR SELECT TO authenticated
  USING (telegram_id IN (SELECT telegram_chat_id FROM public.profiles WHERE id = auth.uid()));

-- Allow caregivers to view their patient's logs
CREATE POLICY "Caregivers view patient logs" ON public.reminder_logs
  FOR SELECT TO authenticated
  USING (
    telegram_id IN (
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND p.role = 'CAREGIVER' AND ci.is_active = true
    )
  );

-- Allow users to insert their own logs
CREATE POLICY "Users insert own logs" ON public.reminder_logs
  FOR INSERT TO authenticated
  WITH CHECK (telegram_id IN (SELECT telegram_chat_id FROM public.profiles WHERE id = auth.uid()));

-- Allow caregivers to insert logs for their patient
CREATE POLICY "Caregivers insert patient logs" ON public.reminder_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    telegram_id IN (
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND p.role = 'CAREGIVER' AND ci.is_active = true
    )
  );


-- 4. ADD PHONE NUMBER COLUMN TO PROFILES
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone_number TEXT;


-- 5. COMPLIANCE AUDIT LOGS
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on audit logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own audit logs" ON public.audit_logs;
CREATE POLICY "Users can manage their own audit logs" ON public.audit_logs
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- 6. ENABLE REALTIME FOR REMINDER EVENTS
ALTER PUBLICATION supabase_realtime ADD TABLE public.reminder_events;


-- 7. DATABASE-LEVEL TRANSITION RULES FOR REMINDER EVENTS
CREATE OR REPLACE FUNCTION public.validate_reminder_event_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- If status is not changing, allow it
  IF OLD.reminder_status = NEW.reminder_status THEN
    RETURN NEW;
  END IF;

  -- Once status is in a final state (TAKEN, SKIPPED, RESOLVED_BY_CG, MISSED), it cannot transition.
  IF OLD.reminder_status IN ('TAKEN', 'SKIPPED', 'RESOLVED_BY_CG', 'MISSED') THEN
    RAISE EXCEPTION 'Forbidden transition: cannot change status from final state % to %', OLD.reminder_status, NEW.reminder_status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_validate_reminder_event_status_transition ON public.reminder_events;
CREATE TRIGGER trigger_validate_reminder_event_status_transition
BEFORE UPDATE ON public.reminder_events
FOR EACH ROW
EXECUTE FUNCTION public.validate_reminder_event_status_transition();

