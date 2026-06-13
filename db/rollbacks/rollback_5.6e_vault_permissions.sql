-- Rollback: Sprint 5.6E — Health Vault Permission Enforcement
-- Run this script in the Supabase SQL Editor if you need to rollback Sprint 5.6E.

-- 1. Drop storage.objects policy
DROP POLICY IF EXISTS "Caregivers can view patient files" ON storage.objects;

-- 2. Drop health_records policies
DROP POLICY IF EXISTS "Caregivers can view patient records" ON public.health_records;

-- 3. Drop health_categories policies
DROP POLICY IF EXISTS "Caregivers can view patient categories" ON public.health_categories;

-- 4. Drop health_records triggers, functions, index, and column
DROP TRIGGER IF EXISTS trg_health_records_storage_path ON public.health_records;
DROP FUNCTION IF EXISTS public.handle_health_records_storage_path();
DROP INDEX IF EXISTS idx_health_records_storage_path;
ALTER TABLE public.health_records DROP COLUMN IF EXISTS storage_path;

-- 5. Restore previous public.handle_caregiver_connection_trust_events() function
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
