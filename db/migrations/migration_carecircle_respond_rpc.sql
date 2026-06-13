-- Re-MIND-eЯ: Care Circle acceptance workflow + dual-role + state-machine hardening
-- Migration: migration_carecircle_respond_rpc.sql
--
-- Fixes (Sprint 5.7C continuation):
--  P0  Caregiver could not accept a request: validate_caregiver_connection_updates forbade
--      caregiver PENDING->ACCEPTED, and there was no accept RPC.
--  P0  Caregiver self-revoke of a PRIMARY connection failed: the AFTER reassign trigger's
--      cross-row UPDATE tripped the validation trigger (caller is neither that row's caregiver
--      nor the patient). Fixed with a transaction-local internal-bypass GUC.
--  P1  Single-role gate in invite_caregiver blocked dual (patient+caregiver) users.
--  P2  Accept notification was addressed to the caregiver; it should tell the PATIENT that the
--      caregiver accepted. Revoke notification fired even when merely declining a PENDING invite.

BEGIN;

-- 1. Validation trigger: allow caregiver to ACCEPT/REJECT a pending request and honor an
--    internal-bypass GUC used by system triggers (e.g. primary reassignment).
CREATE OR REPLACE FUNCTION public.validate_caregiver_connection_updates()
RETURNS TRIGGER AS $$
DECLARE
  caller_uid UUID;
BEGIN
  caller_uid := auth.uid();

  -- System/service-role context, or an internal trigger-driven update, bypasses validation.
  IF caller_uid IS NULL OR current_setting('app.cc_internal', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- Connection endpoints are immutable
  IF OLD.patient_profile_id != NEW.patient_profile_id
     OR OLD.caregiver_profile_id != NEW.caregiver_profile_id THEN
    RAISE EXCEPTION 'Forbidden: cannot modify connection profile associations';
  END IF;

  IF OLD.caregiver_profile_id = caller_uid THEN
    -- Caregiver-side transitions
    IF OLD.connection_status = 'PENDING' AND NEW.connection_status = 'ACCEPTED' THEN
      -- Accepting: auto_assign_primary_caregiver may set is_primary, so don't guard it here,
      -- but the caregiver must not alter granular permissions or relationship metadata.
      IF OLD.can_view_medications IS DISTINCT FROM NEW.can_view_medications
         OR OLD.can_view_vault IS DISTINCT FROM NEW.can_view_vault
         OR OLD.can_view_reports IS DISTINCT FROM NEW.can_view_reports
         OR OLD.can_edit_medications IS DISTINCT FROM NEW.can_edit_medications
         OR OLD.can_receive_escalations IS DISTINCT FROM NEW.can_receive_escalations
         OR OLD.relationship_type IS DISTINCT FROM NEW.relationship_type THEN
        RAISE EXCEPTION 'Forbidden: caregiver cannot modify permissions or relationship metadata';
      END IF;

    ELSIF (OLD.connection_status = 'PENDING' AND NEW.connection_status IN ('REJECTED', 'WITHDRAWN'))
       OR (OLD.connection_status = 'ACCEPTED' AND NEW.connection_status = 'REJECTED') THEN
      -- Declining a pending request or disconnecting an accepted one.
      IF OLD.is_primary IS DISTINCT FROM NEW.is_primary
         OR OLD.can_view_medications IS DISTINCT FROM NEW.can_view_medications
         OR OLD.can_view_vault IS DISTINCT FROM NEW.can_view_vault
         OR OLD.can_view_reports IS DISTINCT FROM NEW.can_view_reports
         OR OLD.can_edit_medications IS DISTINCT FROM NEW.can_edit_medications
         OR OLD.can_receive_escalations IS DISTINCT FROM NEW.can_receive_escalations
         OR OLD.relationship_type IS DISTINCT FROM NEW.relationship_type THEN
        RAISE EXCEPTION 'Forbidden: caregiver cannot modify permissions or relationship metadata';
      END IF;

    ELSE
      RAISE EXCEPTION 'Forbidden: caregiver is only authorized to accept, decline, or disconnect';
    END IF;

  ELSIF OLD.patient_profile_id = caller_uid THEN
    -- Patient owns the connection and may update status, permissions, primary, relationship.
    NULL;
  ELSE
    RAISE EXCEPTION 'Forbidden: you are not authorized to update this care connection';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Primary reassignment after revoke must run its cross-row promotion in internal context,
--    otherwise a caregiver self-revoke is blocked by validation when promoting a sibling row.
CREATE OR REPLACE FUNCTION public.reassign_primary_after_revoke()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.caregiver_connections
    WHERE patient_profile_id = NEW.patient_profile_id
      AND is_primary = true AND is_active = true AND connection_status = 'ACCEPTED'
  ) THEN
    PERFORM set_config('app.cc_internal', '1', true);
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
    PERFORM set_config('app.cc_internal', '', true);
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Accept/decline/withdraw RPC. Caregiver accepts or declines; patient withdraws.
CREATE OR REPLACE FUNCTION public.respond_to_caregiver_request(p_connection_id UUID, p_action TEXT)
RETURNS VOID AS $$
DECLARE
  uid UUID := auth.uid();
  conn public.caregiver_connections%ROWTYPE;
  act TEXT := upper(coalesce(p_action, ''));
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO conn FROM public.caregiver_connections WHERE id = p_connection_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Connection not found';
  END IF;

  IF act IN ('ACCEPT', 'REJECT') THEN
    IF conn.caregiver_profile_id <> uid THEN
      RAISE EXCEPTION 'Forbidden: only the invited caregiver can respond to this request';
    END IF;
    IF conn.connection_status <> 'PENDING' OR conn.is_active = false THEN
      RAISE EXCEPTION 'No pending request to respond to';
    END IF;
    IF act = 'ACCEPT' THEN
      UPDATE public.caregiver_connections SET connection_status = 'ACCEPTED' WHERE id = p_connection_id;
    ELSE
      UPDATE public.caregiver_connections SET connection_status = 'REJECTED', is_active = false WHERE id = p_connection_id;
    END IF;

  ELSIF act = 'WITHDRAW' THEN
    IF conn.patient_profile_id <> uid THEN
      RAISE EXCEPTION 'Forbidden: only the patient can withdraw this request';
    END IF;
    IF conn.connection_status <> 'PENDING' THEN
      RAISE EXCEPTION 'No pending request to withdraw';
    END IF;
    UPDATE public.caregiver_connections SET connection_status = 'WITHDRAWN', is_active = false WHERE id = p_connection_id;

  ELSE
    RAISE EXCEPTION 'Invalid action: %', p_action;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.respond_to_caregiver_request(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_to_caregiver_request(UUID, TEXT) TO authenticated;

-- 4. invite_caregiver: drop the single-role gate. "Is a caregiver" = has registered a CG-ID.
--    This lets a PATIENT-role user also be invited as a caregiver (bidirectional / family care).
CREATE OR REPLACE FUNCTION public.invite_caregiver(caregiver_id UUID)
RETURNS UUID AS $$
#variable_conflict use_variable
DECLARE
  patient_id UUID;
  existing_id UUID;
  existing_status TEXT;
  existing_active BOOLEAN;
  new_conn_id UUID;
BEGIN
  patient_id := auth.uid();
  IF patient_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF patient_id = caregiver_id THEN
    RAISE EXCEPTION 'Cannot invite yourself';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = caregiver_id) THEN
    RAISE EXCEPTION 'Invalid caregiver profile';
  END IF;

  -- Registered-caregiver check (role-agnostic): the target has an active CG-ID in caregiver_info.
  IF NOT EXISTS (
    SELECT 1 FROM public.caregiver_info ci
    JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
    WHERE p.id = caregiver_id AND ci.is_active = true
  ) THEN
    RAISE EXCEPTION 'This user has not registered as a caregiver yet';
  END IF;

  SELECT id, connection_status, is_active
  INTO existing_id, existing_status, existing_active
  FROM public.caregiver_connections
  WHERE patient_profile_id = patient_id AND caregiver_profile_id = caregiver_id;

  IF existing_id IS NOT NULL THEN
    IF existing_active = true AND existing_status = 'ACCEPTED' THEN
      RAISE EXCEPTION 'Already connected with this caregiver';
    ELSIF existing_active = true AND existing_status = 'PENDING' THEN
      RAISE EXCEPTION 'Connection request is already pending';
    ELSE
      UPDATE public.caregiver_connections
      SET connection_status = 'PENDING', is_active = true,
          expires_at = now() + INTERVAL '30 days', updated_at = now()
      WHERE id = existing_id;
      RETURN existing_id;
    END IF;
  ELSE
    INSERT INTO public.caregiver_connections (
      patient_profile_id, caregiver_profile_id, connection_status, is_active, expires_at
    ) VALUES (
      patient_id, caregiver_id, 'PENDING', true, now() + INTERVAL '30 days'
    ) RETURNING id INTO new_conn_id;
    RETURN new_conn_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5. Trust-events trigger: on ACCEPT, notify the PATIENT (the caregiver accepted their request);
--    only emit the "access revoked" notification for genuine ACCEPTED->revoked transitions
--    (not when a caregiver merely declines a PENDING invite).
CREATE OR REPLACE FUNCTION public.handle_caregiver_connection_trust_events()
RETURNS TRIGGER AS $$
DECLARE
  patient_name TEXT;
  caregiver_name TEXT;
  caller_uid UUID;
  audit_action TEXT := NULL;
  snapshot_before JSONB := '{}'::jsonb;
  snapshot_after JSONB := '{}'::jsonb;
  has_changes BOOLEAN := false;
BEGIN
  caller_uid := auth.uid();
  SELECT full_name INTO patient_name FROM public.profiles WHERE id = NEW.patient_profile_id;
  SELECT full_name INTO caregiver_name FROM public.profiles WHERE id = NEW.caregiver_profile_id;

  IF TG_OP = 'INSERT' THEN
    IF NEW.connection_status = 'PENDING' THEN
      INSERT INTO public.notifications (user_id, title, message, type, connection_id)
      VALUES (NEW.caregiver_profile_id, 'Care Circle Request',
        COALESCE(patient_name, 'A patient') || ' would like you to support their medication routine.',
        'CARE_CIRCLE_ACCESS_REQUEST', NEW.id);
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.connection_status = 'PENDING' AND (OLD.connection_status IS DISTINCT FROM 'PENDING' OR OLD.is_active = false) THEN
      INSERT INTO public.notifications (user_id, title, message, type, connection_id)
      VALUES (NEW.caregiver_profile_id, 'Care Circle Request',
        COALESCE(patient_name, 'A patient') || ' would like you to support their medication routine.',
        'CARE_CIRCLE_ACCESS_REQUEST', NEW.id);

    -- ACCESS GRANTED -> tell the PATIENT their caregiver accepted
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
      VALUES (NEW.patient_profile_id, 'Care Circle Connected',
        COALESCE(caregiver_name, 'Your caregiver') || ' accepted your Care Circle request and now supports your routine.',
        'CARE_CIRCLE_ACCESS_GRANTED', NEW.id);

    -- ACCESS REVOKED -> only for genuine teardown of an ACCEPTED relationship
    ELSIF OLD.connection_status = 'ACCEPTED' AND (NEW.connection_status = 'REJECTED' OR NEW.is_active = false) THEN
      audit_action := 'REVOKED';
      snapshot_before := jsonb_build_object('connection_status', OLD.connection_status, 'is_active', OLD.is_active);
      snapshot_after := jsonb_build_object('connection_status', NEW.connection_status, 'is_active', NEW.is_active);
      has_changes := true;

      INSERT INTO public.notifications (user_id, title, message, type, connection_id)
      VALUES (NEW.caregiver_profile_id, 'Shared Trust Revoked',
        COALESCE(patient_name, 'A patient') || ' has removed your access to their care circle.',
        'CARE_CIRCLE_ACCESS_REVOKED', NEW.id);

    -- PRIMARY PROMOTED
    ELSIF OLD.is_primary = false AND NEW.is_primary = true AND NEW.connection_status = 'ACCEPTED' THEN
      audit_action := 'PRIMARY_PROMOTED';
      snapshot_before := jsonb_build_object('is_primary', OLD.is_primary);
      snapshot_after := jsonb_build_object('is_primary', NEW.is_primary);
      has_changes := true;

      INSERT INTO public.notifications (user_id, title, message, type, connection_id)
      VALUES (NEW.caregiver_profile_id, 'Primary Coordinator Promoted',
        'You have been promoted to Primary Care Coordinator for ' || COALESCE(patient_name, 'patient') || '.',
        'CARE_CIRCLE_PRIMARY_CHANGED', NEW.id);

    -- ACCESS MODIFIED (permissions toggled)
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
      VALUES (NEW.caregiver_profile_id, 'Shared Trust Updated',
        COALESCE(patient_name, 'A patient') || ' has updated your care circle access permissions.',
        'CARE_CIRCLE_ACCESS_UPDATED', NEW.id);
    END IF;
  END IF;

  IF has_changes AND audit_action IS NOT NULL THEN
    INSERT INTO public.caregiver_connection_audit_logs (
      connection_id, patient_profile_id, caregiver_profile_id, action_type, changed_by, details
    ) VALUES (
      NEW.id, NEW.patient_profile_id, NEW.caregiver_profile_id, audit_action,
      COALESCE(caller_uid, NEW.patient_profile_id),
      jsonb_build_object('before', snapshot_before, 'after', snapshot_after)
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
