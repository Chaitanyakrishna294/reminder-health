-- Migration: Sprint 5.6E — Health Vault Permission Enforcement
-- Run this script in the Supabase SQL Editor.

-- ============================================================================
-- 1. SCHEMA UPDATE: Add storage_path column & Auto-Populate Trigger
-- ============================================================================

-- Add storage_path column if it does not exist
ALTER TABLE public.health_records ADD COLUMN IF NOT EXISTS storage_path TEXT;

-- Backfill storage_path from file_url for existing records
UPDATE public.health_records 
SET storage_path = file_url 
WHERE storage_path IS NULL;

-- Create index for deterministic storage RLS joins
CREATE INDEX IF NOT EXISTS idx_health_records_storage_path 
ON public.health_records(storage_path);

-- Create trigger function to keep storage_path in sync with file_url when not explicitly set
CREATE OR REPLACE FUNCTION public.handle_health_records_storage_path()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.storage_path IS NULL THEN
    NEW.storage_path := NEW.file_url;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- BEFORE trigger to guarantee storage_path population
DROP TRIGGER IF EXISTS trg_health_records_storage_path ON public.health_records;
CREATE TRIGGER trg_health_records_storage_path
BEFORE INSERT OR UPDATE ON public.health_records
FOR EACH ROW
EXECUTE FUNCTION public.handle_health_records_storage_path();


-- ============================================================================
-- 2. DDL POLICY UPDATE: Caregiver SELECT on health_categories & health_records
-- ============================================================================

-- SELECT policy for caregivers on health_categories
DROP POLICY IF EXISTS "Caregivers can view patient categories" ON public.health_categories;
CREATE POLICY "Caregivers can view patient categories" ON public.health_categories
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.caregiver_connections cc
      WHERE cc.patient_profile_id = health_categories.user_id
        AND cc.caregiver_profile_id = auth.uid()
        AND cc.connection_status = 'ACCEPTED'
        AND cc.is_active = true
        AND cc.can_view_vault = true
    )
  );

-- SELECT policy for caregivers on health_records
DROP POLICY IF EXISTS "Caregivers can view patient records" ON public.health_records;
CREATE POLICY "Caregivers can view patient records" ON public.health_records
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.caregiver_connections cc
      WHERE cc.patient_profile_id = health_records.user_id
        AND cc.caregiver_profile_id = auth.uid()
        AND cc.connection_status = 'ACCEPTED'
        AND cc.is_active = true
        AND cc.can_view_vault = true
    )
  );


-- ============================================================================
-- 3. DDL POLICY UPDATE: Caregiver SELECT on storage.objects
-- ============================================================================

DROP POLICY IF EXISTS "Caregivers can view patient files" ON storage.objects;
CREATE POLICY "Caregivers can view patient files" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'health-vault'
    AND EXISTS (
      SELECT 1 FROM public.health_records hr
      JOIN public.caregiver_connections cc ON cc.patient_profile_id = hr.user_id
      WHERE hr.storage_path = name
        AND cc.caregiver_profile_id = auth.uid()
        AND cc.connection_status = 'ACCEPTED'
        AND cc.is_active = true
        AND cc.can_view_vault = true
    )
  );


-- ============================================================================
-- 4. GOVERNANCE TRIGGER UPDATE: Customize vault-access notifications
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
  notification_msg TEXT;
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

    -- Dynamic Custom Message for Vault Permission toggles
    IF OLD.can_view_vault != NEW.can_view_vault THEN
      IF NEW.can_view_vault = true THEN
        notification_msg := COALESCE(patient_name, 'A patient') || ' has shared Health Vault documents with you.';
      ELSE
        notification_msg := COALESCE(patient_name, 'A patient') || ' has removed access to shared Health Vault documents.';
      END IF;
    ELSE
      notification_msg := COALESCE(patient_name, 'A patient') || ' has updated your care circle access permissions.';
    END IF;

    INSERT INTO public.notifications (user_id, title, message, type, connection_id)
    VALUES (
      NEW.caregiver_profile_id, 
      'Shared Trust Updated', 
      notification_msg, 
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
