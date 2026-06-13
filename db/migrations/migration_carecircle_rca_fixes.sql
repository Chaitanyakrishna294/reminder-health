-- Re-MIND-eЯ Production Fixes: Care Circle Many-to-Many Notification Triggers
-- Migration Script: migration_carecircle_rca_fixes.sql

BEGIN;

-- 1. Upgrade Caregiver Connection Trust Events Trigger & Function
-- Change trigger to run on AFTER INSERT OR UPDATE
DROP TRIGGER IF EXISTS trg_audit_and_notify_caregiver_changes ON public.caregiver_connections;

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

  IF TG_OP = 'INSERT' THEN
    IF NEW.connection_status = 'PENDING' THEN
      -- A pending request is NOT a consent event: the audit log check constraint only
      -- permits GRANTED/MODIFIED/REVOKED/PRIMARY_PROMOTED, so we emit the notification
      -- (audit_action stays NULL → no audit row) but never write a 'REQUESTED' audit log.

      -- Trigger-driven request notification bypasses RLS
      INSERT INTO public.notifications (user_id, title, message, type, connection_id)
      VALUES (
        NEW.caregiver_profile_id, 
        'Care Circle Request', 
        COALESCE(patient_name, 'A patient') || ' would like you to support their medication routine.', 
        'CARE_CIRCLE_ACCESS_REQUEST',
        NEW.id
      );
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Check if this is a reactivation / re-request (notification only, no consent audit row)
    IF NEW.connection_status = 'PENDING' AND (OLD.connection_status IS DISTINCT FROM 'PENDING' OR OLD.is_active = false) THEN
      INSERT INTO public.notifications (user_id, title, message, type, connection_id)
      VALUES (
        NEW.caregiver_profile_id,
        'Care Circle Request',
        COALESCE(patient_name, 'A patient') || ' would like you to support their medication routine.',
        'CARE_CIRCLE_ACCESS_REQUEST',
        NEW.id
      );

    -- 1. ACCESS GRANTED
    ELSIF OLD.connection_status = 'PENDING' AND NEW.connection_status = 'ACCEPTED' THEN
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

    -- 2. ACCESS REVOKED
    ELSIF (OLD.connection_status = 'ACCEPTED' AND NEW.connection_status = 'REJECTED') OR (OLD.is_active = true AND NEW.is_active = false) THEN
      audit_action := 'REVOKED';
      snapshot_before := jsonb_build_object('connection_status', OLD.connection_status, 'is_active', OLD.is_active);
      snapshot_after := jsonb_build_object('connection_status', NEW.connection_status, 'is_active', NEW.is_active);
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

CREATE TRIGGER trg_audit_and_notify_caregiver_changes
AFTER INSERT OR UPDATE ON public.caregiver_connections
FOR EACH ROW
EXECUTE FUNCTION public.handle_caregiver_connection_trust_events();


-- 2. Upgrade handle_reminder_event_state_change to Loop and Fan Out to All Accepted Caregivers
-- NOTE: reminder_events historically carried two identical AFTER INSERT OR UPDATE triggers
-- (on_reminder_event_state_change AND trigger_reminder_event_state_change) both calling this
-- same function. With the new fan-out loop that would emit duplicate notifications per caregiver
-- for every TAKEN/SKIPPED/UNCONFIRMED transition. Drop the redundant one, keep a single trigger.
DROP TRIGGER IF EXISTS trigger_reminder_event_state_change ON public.reminder_events;

CREATE OR REPLACE FUNCTION public.handle_reminder_event_state_change()
RETURNS TRIGGER AS $$
DECLARE
  patient_uid UUID;
  patient_name TEXT;
  med_name TEXT;
  cg_rec RECORD;
  is_status_transition BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    is_status_transition := TRUE;
  ELSE
    is_status_transition := OLD.reminder_status IS DISTINCT FROM NEW.reminder_status;
  END IF;

  IF NOT is_status_transition THEN
    RETURN NEW;
  END IF;

  -- Get Medication Drug Name
  SELECT drug_name INTO med_name FROM public.medications WHERE id = NEW.medication_id;

  -- Resolve Patient UUID & Name
  SELECT id, full_name INTO patient_uid, patient_name
  FROM public.profiles
  WHERE telegram_chat_id = NEW.telegram_id;

  -- 2.1 Patient-Self Notifications (always delivered to patient)
  IF patient_uid IS NOT NULL THEN
    IF NEW.reminder_status = 'TAKEN' THEN
      IF NEW.resolved_by = 'CAREGIVER_CONFIRMED' THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          patient_uid, 
          'Medication Marked Taken', 
          'Your caregiver marked ' || COALESCE(med_name, 'your medication') || ' as taken.', 
          'TAKEN'
        );
      ELSE
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          patient_uid, 
          'Medication Taken', 
          'You successfully took ' || COALESCE(med_name, 'your medication') || '.', 
          'TAKEN'
        );
      END IF;

    ELSIF NEW.reminder_status = 'SKIPPED' THEN
      IF NEW.resolved_by = 'CAREGIVER_CONFIRMED' THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          patient_uid, 
          'Medication Marked Skipped', 
          'Your caregiver marked ' || COALESCE(med_name, 'your medication') || ' as skipped.', 
          'SKIPPED'
        );
      ELSE
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          patient_uid, 
          'Medication Skipped', 
          'You skipped ' || COALESCE(med_name, 'your medication') || '.', 
          'SKIPPED'
        );
      END IF;

    ELSIF NEW.reminder_status = 'UNCONFIRMED' THEN
      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (
        patient_uid, 
        'Medication Review Required', 
        'Help Us Complete Your Medication History: You have a pending review dose of ' || COALESCE(med_name, 'your medication') || ' from earlier today.', 
        'UNCONFIRMED'
      );
    END IF;
  END IF;

  -- 2.2 Multi-Caregiver Fan-Out (using caregiver_connections)
  IF patient_uid IS NOT NULL THEN
    FOR cg_rec IN (
      SELECT 
        cc.caregiver_profile_id,
        cc.can_view_medications,
        cc.can_receive_escalations
      FROM public.caregiver_connections cc
      WHERE cc.patient_profile_id = patient_uid
        AND cc.is_active = true
        AND cc.connection_status = 'ACCEPTED'
    ) LOOP

      -- Handle TAKEN for Caregiver
      IF NEW.reminder_status = 'TAKEN' AND cg_rec.can_view_medications = true THEN
        IF NEW.resolved_by = 'CAREGIVER_CONFIRMED' THEN
          INSERT INTO public.notifications (user_id, title, message, type)
          VALUES (
            cg_rec.caregiver_profile_id, 
            'Medication Marked Taken', 
            CASE WHEN auth.uid() = cg_rec.caregiver_profile_id THEN 
              'You marked ' || COALESCE(patient_name, 'your patient') || '''s medication ' || COALESCE(med_name, 'medication') || ' as taken.'
            ELSE 
              'A caregiver marked ' || COALESCE(patient_name, 'your patient') || '''s medication ' || COALESCE(med_name, 'medication') || ' as taken.'
            END, 
            'TAKEN'
          );
        ELSE
          INSERT INTO public.notifications (user_id, title, message, type)
          VALUES (
            cg_rec.caregiver_profile_id, 
            'Medication Taken', 
            COALESCE(patient_name, 'Patient') || ' took their medication ' || COALESCE(med_name, 'medication') || '.', 
            'TAKEN'
          );
        END IF;

      -- Handle SKIPPED for Caregiver
      ELSIF NEW.reminder_status = 'SKIPPED' AND cg_rec.can_view_medications = true THEN
        IF NEW.resolved_by = 'CAREGIVER_CONFIRMED' THEN
          INSERT INTO public.notifications (user_id, title, message, type)
          VALUES (
            cg_rec.caregiver_profile_id, 
            'Medication Marked Skipped', 
            CASE WHEN auth.uid() = cg_rec.caregiver_profile_id THEN 
              'You marked ' || COALESCE(patient_name, 'your patient') || '''s medication ' || COALESCE(med_name, 'medication') || ' as skipped.'
            ELSE 
              'A caregiver marked ' || COALESCE(patient_name, 'your patient') || '''s medication ' || COALESCE(med_name, 'medication') || ' as skipped.'
            END, 
            'SKIPPED'
          );
        ELSE
          INSERT INTO public.notifications (user_id, title, message, type)
          VALUES (
            cg_rec.caregiver_profile_id, 
            'Medication Skipped', 
            COALESCE(patient_name, 'Patient') || ' skipped their medication ' || COALESCE(med_name, 'medication') || '.', 
            'SKIPPED'
          );
        END IF;

      -- Handle ESCALATED for Caregiver
      ELSIF NEW.reminder_status = 'ESCALATED' AND cg_rec.can_receive_escalations = true THEN
        -- Deduplicate within 2 minutes
        IF NOT EXISTS (
          SELECT 1 FROM public.notifications 
          WHERE user_id = cg_rec.caregiver_profile_id 
            AND type = 'ESCALATED' 
            AND message LIKE '%' || COALESCE(med_name, '') || '%'
            AND created_at > now() - interval '2 minutes'
        ) THEN
          INSERT INTO public.notifications (user_id, title, message, type)
          VALUES (
            cg_rec.caregiver_profile_id, 
            '🚨 Medication Escalation Alert', 
            'Alert: A critical medication for ' || COALESCE(patient_name, 'your patient') || ' (' || COALESCE(med_name, 'medication') || ') has not yet been confirmed.', 
            'ESCALATED'
          );
        END IF;

      -- Handle UNCONFIRMED for Caregiver
      ELSIF NEW.reminder_status = 'UNCONFIRMED' AND cg_rec.can_receive_escalations = true THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          cg_rec.caregiver_profile_id, 
          'Medication Dose Unconfirmed', 
          'Dose Unconfirmed: ' || COALESCE(patient_name, 'Patient') || ' did not confirm taking their medication ' || COALESCE(med_name, 'medication') || ' today.', 
          'UNCONFIRMED'
        );
      END IF;

    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Fix primary-caregiver reassignment on revoke (many-to-many revocation).
-- The existing auto_assign_primary_caregiver() ran BEFORE UPDATE and, when the PRIMARY
-- connection was revoked, promoted the next caregiver to primary *while the revoked row
-- was still committed as an active accepted primary*. With 2+ caregivers that produced two
-- rows matching idx_single_active_primary_caregiver (UNIQUE per patient WHERE is_primary AND
-- is_active AND connection_status='ACCEPTED') → "duplicate key" and the revoke failed
-- entirely. Split responsibilities: BEFORE UPDATE only assigns primary on accept; an AFTER
-- UPDATE trigger promotes a replacement once the revoked row has left the index.
CREATE OR REPLACE FUNCTION public.auto_assign_primary_caregiver()
RETURNS TRIGGER AS $$
DECLARE
  existing_primary_count INTEGER;
BEGIN
  IF NEW.connection_status = 'ACCEPTED' AND
     (OLD.connection_status IS NULL OR OLD.connection_status IS DISTINCT FROM 'ACCEPTED') THEN

    SELECT COUNT(*) INTO existing_primary_count
    FROM public.caregiver_connections
    WHERE patient_profile_id = NEW.patient_profile_id
      AND is_primary = true
      AND is_active = true
      AND connection_status = 'ACCEPTED'
      AND id != NEW.id;

    IF existing_primary_count = 0 THEN
      NEW.is_primary := true;
    ELSE
      NEW.is_primary := false;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.reassign_primary_after_revoke()
RETURNS TRIGGER AS $$
BEGIN
  -- Only promote a replacement if the patient now has no active accepted primary
  IF NOT EXISTS (
    SELECT 1 FROM public.caregiver_connections
    WHERE patient_profile_id = NEW.patient_profile_id
      AND is_primary = true
      AND is_active = true
      AND connection_status = 'ACCEPTED'
  ) THEN
    UPDATE public.caregiver_connections
    SET is_primary = true, updated_at = now()
    WHERE id = (
      SELECT id FROM public.caregiver_connections
      WHERE patient_profile_id = NEW.patient_profile_id
        AND is_active = true
        AND connection_status = 'ACCEPTED'
        AND id != NEW.id
      ORDER BY created_at ASC
      LIMIT 1
    );
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_reassign_primary_after_revoke ON public.caregiver_connections;
CREATE TRIGGER trg_reassign_primary_after_revoke
AFTER UPDATE ON public.caregiver_connections
FOR EACH ROW
WHEN (
  OLD.is_primary = true AND OLD.is_active = true AND OLD.connection_status = 'ACCEPTED'
  AND NOT (NEW.is_primary = true AND NEW.is_active = true AND NEW.connection_status = 'ACCEPTED')
)
EXECUTE FUNCTION public.reassign_primary_after_revoke();

COMMIT;
