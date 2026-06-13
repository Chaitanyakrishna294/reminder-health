-- Re-MIND-eЯ Sprint 5.6D: Rollback Script
-- Reverts: RLS on caregiver_connections and audit logs, validation/auditing triggers,
--          and reinstates legacy RLS check constraints.

BEGIN;

-- ============================================================================
-- 1. REVERT RLS ON MEDICATIONS, EVENTS, AND LOGS
-- ============================================================================

-- Revert Medications SELECT Policy
DROP POLICY IF EXISTS "Caregivers can view patient medications" ON public.medications;
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

-- Revert Reminder Events SELECT Policy
DROP POLICY IF EXISTS "Caregivers view patient events" ON public.reminder_events;
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

-- Revert Reminder Events UPDATE Policy
DROP POLICY IF EXISTS "Caregivers resolve patient events" ON public.reminder_events;
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

-- Revert Reminder Logs SELECT Policy
DROP POLICY IF EXISTS "Caregivers view patient logs" ON public.reminder_logs;
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

-- Revert Reminder Logs INSERT Policy
DROP POLICY IF EXISTS "Caregivers insert patient logs" ON public.reminder_logs;
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


-- ============================================================================
-- 2. DROP CONNECTION TRIGGERS & FUNCTIONS
-- ============================================================================
DROP TRIGGER IF EXISTS trg_audit_and_notify_caregiver_changes ON public.caregiver_connections;
DROP FUNCTION IF EXISTS public.handle_caregiver_connection_trust_events();

DROP TRIGGER IF EXISTS trg_validate_caregiver_connections ON public.caregiver_connections;
DROP FUNCTION IF EXISTS public.validate_caregiver_connection_updates();


-- ============================================================================
-- 3. DISABLE RLS ON CONNECTIONS & DROP AUDIT LOG TABLE
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own connections" ON public.caregiver_connections;
DROP POLICY IF EXISTS "Caregivers can request connection" ON public.caregiver_connections;
DROP POLICY IF EXISTS "Users can update own connections" ON public.caregiver_connections;
ALTER TABLE public.caregiver_connections DISABLE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS public.caregiver_connection_audit_logs CASCADE;


-- ============================================================================
-- 4. REVERT NOTIFICATION TYPES TO SPRINT 5.6C
-- ============================================================================
ALTER TABLE public.notifications 
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications 
ADD CONSTRAINT notifications_type_check 
CHECK (type IN ('TAKEN', 'SKIPPED', 'MISSED', 'ESCALATED', 'CARE_CIRCLE_ACCESS_REQUEST'));

COMMIT;
