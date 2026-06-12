-- Re-MIND-eЯ Sprint 5.6D: Care Circle Trust Center & Permission Governance
-- Migration Script: migration_5.6d_trust_center.sql
-- Run this in your Supabase SQL Editor.

BEGIN;

-- ============================================================================
-- 1. NOTIFICATION TYPE CONSTRAINT
-- ============================================================================
-- Update notifications constraint to support dedicated Care Circle notification types
ALTER TABLE public.notifications 
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications 
ADD CONSTRAINT notifications_type_check 
CHECK (type IN (
  'TAKEN', 'SKIPPED', 'MISSED', 'ESCALATED', 
  'CARE_CIRCLE_ACCESS_REQUEST', 
  'CARE_CIRCLE_ACCESS_GRANTED', 
  'CARE_CIRCLE_ACCESS_UPDATED', 
  'CARE_CIRCLE_ACCESS_REVOKED', 
  'CARE_CIRCLE_PRIMARY_CHANGED'
));


-- ============================================================================
-- 2. CONSENT HISTORY AUDIT LOG TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.caregiver_connection_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID REFERENCES public.caregiver_connections(id) ON DELETE SET NULL,
  patient_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  caregiver_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('GRANTED', 'MODIFIED', 'REVOKED', 'PRIMARY_PROMOTED')),
  changed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  details JSONB NOT NULL, -- explicit before/after snapshots
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on audit logs
ALTER TABLE public.caregiver_connection_audit_logs ENABLE ROW LEVEL SECURITY;

-- SELECT policy: Patient or caregiver can view the connection history logs
DROP POLICY IF EXISTS "Users can view own connection audit logs" ON public.caregiver_connection_audit_logs;
CREATE POLICY "Users can view own connection audit logs" ON public.caregiver_connection_audit_logs
  FOR SELECT TO authenticated
  USING (
    patient_profile_id = auth.uid()
    OR
    caregiver_profile_id = auth.uid()
  );

-- Indexes for audit logs lookup performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_patient 
ON public.caregiver_connection_audit_logs(patient_profile_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_caregiver 
ON public.caregiver_connection_audit_logs(caregiver_profile_id);


-- ============================================================================
-- 3. CAREGIVER CONNECTIONS RLS POLICIES
-- ============================================================================
ALTER TABLE public.caregiver_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own connections" ON public.caregiver_connections;
CREATE POLICY "Users can view own connections" ON public.caregiver_connections
  FOR SELECT TO authenticated
  USING (
    patient_profile_id = auth.uid() 
    OR 
    caregiver_profile_id = auth.uid()
  );

DROP POLICY IF EXISTS "Caregivers can request connection" ON public.caregiver_connections;
CREATE POLICY "Caregivers can request connection" ON public.caregiver_connections
  FOR INSERT TO authenticated
  WITH CHECK (
    caregiver_profile_id = auth.uid()
    AND connection_status = 'PENDING'
  );

DROP POLICY IF EXISTS "Users can update own connections" ON public.caregiver_connections;
CREATE POLICY "Users can update own connections" ON public.caregiver_connections
  FOR UPDATE TO authenticated
  USING (
    patient_profile_id = auth.uid() 
    OR 
    caregiver_profile_id = auth.uid()
  );


-- ============================================================================
-- 4. CONNECTION UPDATE VALIDATION TRIGGER (Tightened Boundaries)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.validate_caregiver_connection_updates()
RETURNS TRIGGER AS $$
DECLARE
  caller_uid UUID;
BEGIN
  caller_uid := auth.uid();

  -- If update is made via system/definir context, allow it
  IF caller_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Ensure connection profiles are never changed
  IF OLD.patient_profile_id != NEW.patient_profile_id OR OLD.caregiver_profile_id != NEW.caregiver_profile_id THEN
    RAISE EXCEPTION 'Forbidden: cannot modify connection profile associations';
  END IF;

  -- Enforce caregiver-side restrictions
  IF OLD.caregiver_profile_id = caller_uid THEN
    -- Caregivers can only transition connection_status from PENDING -> WITHDRAWN or ACCEPTED -> REJECTED (unlink)
    -- and they cannot modify other fields
    IF (OLD.connection_status = 'PENDING' AND NEW.connection_status = 'WITHDRAWN') OR
       (OLD.connection_status = 'ACCEPTED' AND NEW.connection_status = 'REJECTED') THEN
      
      -- Enforce no modifications to permissions, primary status, or relationship type
      IF OLD.is_primary IS DISTINCT FROM NEW.is_primary OR
         OLD.can_view_medications IS DISTINCT FROM NEW.can_view_medications OR
         OLD.can_view_vault IS DISTINCT FROM NEW.can_view_vault OR
         OLD.can_view_reports IS DISTINCT FROM NEW.can_view_reports OR
         OLD.can_edit_medications IS DISTINCT FROM NEW.can_edit_medications OR
         OLD.can_receive_escalations IS DISTINCT FROM NEW.can_receive_escalations OR
         OLD.relationship_type IS DISTINCT FROM NEW.relationship_type THEN
        RAISE EXCEPTION 'Forbidden: caregiver cannot modify permissions or relationship metadata';
      END IF;
    ELSE
      RAISE EXCEPTION 'Forbidden: caregiver is only authorized to withdraw a request or disconnect';
    END IF;

  -- Enforce patient-side restrictions (they can update everything but caller checks are needed)
  ELSIF OLD.patient_profile_id = caller_uid THEN
    -- Patient is the owner and can update status, permissions, relationship, and is_primary.
    -- (Validation passes)
    NULL;
  ELSE
    RAISE EXCEPTION 'Forbidden: you are not authorized to update this care connection';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_caregiver_connections ON public.caregiver_connections;
CREATE TRIGGER trg_validate_caregiver_connections
BEFORE UPDATE ON public.caregiver_connections
FOR EACH ROW
EXECUTE FUNCTION public.validate_caregiver_connection_updates();


-- ============================================================================
-- 5. TRUST EVENT AUDITING AND NOTIFICATION FAN-OUT (Trigger-Driven)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_caregiver_connection_trust_events()
RETURNS TRIGGER AS $$
DECLARE
  patient_name TEXT;
  caller_uid UUID;
  audit_action TEXT := NULL;
  snapshot_before JSONB := '{}'::jsonb;
  snapshot_after JSONB := '{}'::jsonb;
  has_changes BOOLEAN := false;
BEGIN
  caller_uid := auth.uid();
  SELECT full_name INTO patient_name FROM public.profiles WHERE id = NEW.patient_profile_id;

  -- Determine action type & construct change snapshot
  
  -- 1. ACCESS GRANTED
  IF OLD.connection_status = 'PENDING' AND NEW.connection_status = 'ACCEPTED' THEN
    audit_action := 'GRANTED';
    snapshot_before := jsonb_build_object('connection_status', OLD.connection_status);
    snapshot_after := jsonb_build_object(
      'connection_status', NEW.connection_status,
      'relationship_type', NEW.relationship_type,
      'is_primary', NEW.is_primary,
      'can_view_medications', NEW.can_view_medications,
      'can_view_vault', NEW.can_view_vault,
      'can_view_reports', NEW.can_view_reports,
      'can_edit_medications', NEW.can_edit_medications,
      'can_receive_escalations', NEW.can_receive_escalations
    );
    has_changes := true;

    -- ephemereal notification
    INSERT INTO public.notifications (user_id, title, message, type, connection_id)
    VALUES (
      NEW.caregiver_profile_id, 
      'Shared Trust Granted', 
      COALESCE(patient_name, 'A patient') || ' has accepted your request and shared their care circle with you.', 
      'CARE_CIRCLE_ACCESS_GRANTED',
      NEW.id
    );

  -- 2. ACCESS REVOKED (ACCEPTED -> REJECTED)
  ELSIF OLD.connection_status = 'ACCEPTED' AND NEW.connection_status = 'REJECTED' THEN
    audit_action := 'REVOKED';
    snapshot_before := jsonb_build_object('connection_status', OLD.connection_status);
    snapshot_after := jsonb_build_object('connection_status', NEW.connection_status);
    has_changes := true;

    INSERT INTO public.notifications (user_id, title, message, type, connection_id)
    VALUES (
      NEW.caregiver_profile_id, 
      'Shared Trust Revoked', 
      COALESCE(patient_name, 'A patient') || ' has removed your access to their care circle.', 
      'CARE_CIRCLE_ACCESS_REVOKED',
      NEW.id
    );

  -- 3. PRIMARY PROMOTED
  ELSIF OLD.is_primary = false AND NEW.is_primary = true AND NEW.connection_status = 'ACCEPTED' THEN
    audit_action := 'PRIMARY_PROMOTED';
    snapshot_before := jsonb_build_object('is_primary', OLD.is_primary);
    snapshot_after := jsonb_build_object('is_primary', NEW.is_primary);
    has_changes := true;

    INSERT INTO public.notifications (user_id, title, message, type, connection_id)
    VALUES (
      NEW.caregiver_profile_id, 
      'Primary Coordinator Promoted', 
      'You have been promoted to Primary Care Coordinator for ' || COALESCE(patient_name, 'patient') || '.', 
      'CARE_CIRCLE_PRIMARY_CHANGED',
      NEW.id
    );

  -- 4. ACCESS MODIFIED (Permissions toggled)
  ELSIF NEW.connection_status = 'ACCEPTED' AND OLD.connection_status = 'ACCEPTED' AND (
        OLD.can_view_medications != NEW.can_view_medications OR
        OLD.can_view_vault != NEW.can_view_vault OR
        OLD.can_view_reports != NEW.can_view_reports OR
        OLD.can_edit_medications != NEW.can_edit_medications OR
        OLD.can_receive_escalations != NEW.can_receive_escalations OR
        OLD.relationship_type != NEW.relationship_type
  ) THEN
    audit_action := 'MODIFIED';
    has_changes := true;
    
    -- Compile before/after map diffs
    IF OLD.can_view_medications != NEW.can_view_medications THEN
      snapshot_before := snapshot_before || jsonb_build_object('can_view_medications', OLD.can_view_medications);
      snapshot_after := snapshot_after || jsonb_build_object('can_view_medications', NEW.can_view_medications);
    END IF;
    IF OLD.can_view_vault != NEW.can_view_vault THEN
      snapshot_before := snapshot_before || jsonb_build_object('can_view_vault', OLD.can_view_vault);
      snapshot_after := snapshot_after || jsonb_build_object('can_view_vault', NEW.can_view_vault);
    END IF;
    IF OLD.can_view_reports != NEW.can_view_reports THEN
      snapshot_before := snapshot_before || jsonb_build_object('can_view_reports', OLD.can_view_reports);
      snapshot_after := snapshot_after || jsonb_build_object('can_view_reports', NEW.can_view_reports);
    END IF;
    IF OLD.can_edit_medications != NEW.can_edit_medications THEN
      snapshot_before := snapshot_before || jsonb_build_object('can_edit_medications', OLD.can_edit_medications);
      snapshot_after := snapshot_after || jsonb_build_object('can_edit_medications', NEW.can_edit_medications);
    END IF;
    IF OLD.can_receive_escalations != NEW.can_receive_escalations THEN
      snapshot_before := snapshot_before || jsonb_build_object('can_receive_escalations', OLD.can_receive_escalations);
      snapshot_after := snapshot_after || jsonb_build_object('can_receive_escalations', NEW.can_receive_escalations);
    END IF;
    IF OLD.relationship_type != NEW.relationship_type THEN
      snapshot_before := snapshot_before || jsonb_build_object('relationship_type', OLD.relationship_type);
      snapshot_after := snapshot_after || jsonb_build_object('relationship_type', NEW.relationship_type);
    END IF;

    INSERT INTO public.notifications (user_id, title, message, type, connection_id)
    VALUES (
      NEW.caregiver_profile_id, 
      'Shared Trust Updated', 
      COALESCE(patient_name, 'A patient') || ' has updated your care circle access permissions.', 
      'CARE_CIRCLE_ACCESS_UPDATED',
      NEW.id
    );
  END IF;

  -- Write to audit log if connection was modified
  IF has_changes AND audit_action IS NOT NULL THEN
    INSERT INTO public.caregiver_connection_audit_logs (
      connection_id,
      patient_profile_id,
      caregiver_profile_id,
      action_type,
      changed_by,
      details
    ) VALUES (
      NEW.id,
      NEW.patient_profile_id,
      NEW.caregiver_profile_id,
      audit_action,
      COALESCE(caller_uid, NEW.patient_profile_id),
      jsonb_build_object('before', snapshot_before, 'after', snapshot_after)
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_audit_and_notify_caregiver_changes ON public.caregiver_connections;
CREATE TRIGGER trg_audit_and_notify_caregiver_changes
AFTER UPDATE ON public.caregiver_connections
FOR EACH ROW
EXECUTE FUNCTION public.handle_caregiver_connection_trust_events();


-- ============================================================================
-- 6. MEDICATIONS, EVENTS, AND LOGS RLS UPGRADES (Dual-Read Compatibility)
-- ============================================================================

-- 6a. Medications SELECT Policy
DROP POLICY IF EXISTS "Caregivers can view patient medications" ON public.medications;
CREATE POLICY "Caregivers can view patient medications" ON public.medications
  FOR SELECT TO authenticated
  USING (
    telegram_id IN (
      -- Upgraded RLS Path (caregiver_connections check)
      SELECT p_pat.telegram_chat_id 
      FROM public.caregiver_connections cc
      JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id
      WHERE cc.caregiver_profile_id = auth.uid() 
        AND cc.is_active = true 
        AND cc.connection_status = 'ACCEPTED'
        AND cc.can_view_medications = true
      
      UNION
      
      -- Dual-Read Legacy Path (backward compatibility)
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND p.role = 'CAREGIVER' AND ci.is_active = true
    )
  );

-- 6b. Reminder Events SELECT Policy
DROP POLICY IF EXISTS "Caregivers view patient events" ON public.reminder_events;
CREATE POLICY "Caregivers view patient events" ON public.reminder_events
  FOR SELECT TO authenticated
  USING (
    telegram_id IN (
      -- Upgraded RLS Path
      SELECT p_pat.telegram_chat_id 
      FROM public.caregiver_connections cc
      JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id
      WHERE cc.caregiver_profile_id = auth.uid() 
        AND cc.is_active = true 
        AND cc.connection_status = 'ACCEPTED'
        AND cc.can_view_medications = true
      
      UNION
      
      -- Dual-Read Legacy Path
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND p.role = 'CAREGIVER' AND ci.is_active = true
    )
  );

-- 6c. Reminder Events UPDATE Policy (Resolving/Responding)
DROP POLICY IF EXISTS "Caregivers resolve patient events" ON public.reminder_events;
CREATE POLICY "Caregivers resolve patient events" ON public.reminder_events
  FOR UPDATE TO authenticated
  USING (
    telegram_id IN (
      -- Upgraded RLS Path
      SELECT p_pat.telegram_chat_id 
      FROM public.caregiver_connections cc
      JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id
      WHERE cc.caregiver_profile_id = auth.uid() 
        AND cc.is_active = true 
        AND cc.connection_status = 'ACCEPTED'
        AND (cc.can_edit_medications = true OR cc.can_receive_escalations = true)
      
      UNION
      
      -- Dual-Read Legacy Path
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND p.role = 'CAREGIVER' AND ci.is_active = true
    )
  );

-- 6d. Reminder Logs SELECT Policy
DROP POLICY IF EXISTS "Caregivers view patient logs" ON public.reminder_logs;
CREATE POLICY "Caregivers view patient logs" ON public.reminder_logs
  FOR SELECT TO authenticated
  USING (
    telegram_id IN (
      -- Upgraded RLS Path
      SELECT p_pat.telegram_chat_id 
      FROM public.caregiver_connections cc
      JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id
      WHERE cc.caregiver_profile_id = auth.uid() 
        AND cc.is_active = true 
        AND cc.connection_status = 'ACCEPTED'
        AND cc.can_view_reports = true
      
      UNION
      
      -- Dual-Read Legacy Path
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND p.role = 'CAREGIVER' AND ci.is_active = true
    )
  );

-- 6e. Reminder Logs INSERT Policy (Adding logs)
DROP POLICY IF EXISTS "Caregivers insert patient logs" ON public.reminder_logs;
CREATE POLICY "Caregivers insert patient logs" ON public.reminder_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    telegram_id IN (
      -- Upgraded RLS Path
      SELECT p_pat.telegram_chat_id 
      FROM public.caregiver_connections cc
      JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id
      WHERE cc.caregiver_profile_id = auth.uid() 
        AND cc.is_active = true 
        AND cc.connection_status = 'ACCEPTED'
        AND (cc.can_edit_medications = true OR cc.can_receive_escalations = true)
      
      UNION
      
      -- Dual-Read Legacy Path
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND p.role = 'CAREGIVER' AND ci.is_active = true
    )
  );

COMMIT;
