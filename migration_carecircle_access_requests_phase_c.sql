-- Re-MIND-eЯ Sprint 5.6C: Care Circle Access Requests & Notification Fan-Out
-- Migration Script: migration_carecircle_access_requests_phase_c.sql
-- Run this in your Supabase SQL Editor.
--
-- Prerequisites:
--   - migration_caregiver_decoupling_phase_a.sql must be applied
--   - caregiver_connections table must exist
--
-- Changes:
--   1. Adds request lifecycle columns to caregiver_connections (expires_at, expanded status)
--   2. Adds connection_id FK pointer to notifications table
--   3. Expands notifications type constraint for CARE_CIRCLE_ACCESS_REQUEST
--   4. Rewrites handle_reminder_event_state_change() with tiered multi-caregiver fan-out

BEGIN;

-- ============================================================================
-- 1. CAREGIVER_CONNECTIONS: Add Request Lifecycle Support
-- ============================================================================

-- 1a. Add expires_at column for request expiration (default: 30 days from creation)
ALTER TABLE public.caregiver_connections 
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- 1b. Expand connection_status to include EXPIRED and WITHDRAWN states
ALTER TABLE public.caregiver_connections 
DROP CONSTRAINT IF EXISTS caregiver_connections_connection_status_check;

ALTER TABLE public.caregiver_connections 
ADD CONSTRAINT caregiver_connections_connection_status_check 
CHECK (connection_status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN'));

-- 1c. Backfill expires_at for any existing PENDING connections
UPDATE public.caregiver_connections 
SET expires_at = created_at + INTERVAL '30 days'
WHERE connection_status = 'PENDING' AND expires_at IS NULL;


-- ============================================================================
-- 2. NOTIFICATIONS: Add Access Request Type & Connection Pointer
-- ============================================================================

-- 2a. Drop and recreate type constraint to include CARE_CIRCLE_ACCESS_REQUEST
ALTER TABLE public.notifications 
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications 
ADD CONSTRAINT notifications_type_check 
CHECK (type IN ('TAKEN', 'SKIPPED', 'MISSED', 'ESCALATED', 'CARE_CIRCLE_ACCESS_REQUEST'));

-- 2b. Add connection_id FK referencing caregiver_connections
ALTER TABLE public.notifications 
ADD COLUMN IF NOT EXISTS connection_id UUID 
  REFERENCES public.caregiver_connections(id) ON DELETE CASCADE;

-- 2c. Add index for efficient connection_id lookups
CREATE INDEX IF NOT EXISTS idx_notifications_connection_id
ON public.notifications(connection_id)
WHERE connection_id IS NOT NULL;


-- ============================================================================
-- 3. TIERED NOTIFICATION FAN-OUT TRIGGER
-- ============================================================================
-- Replaces the legacy single-caregiver trigger with multi-caregiver routing:
--   Tier 1 (Broadcast):    MISSED / ESCALATED → all caregivers with can_receive_escalations
--   Tier 2 (Primary-Only): Future schedule conflicts → is_primary only (reserved)
--   Tier 3 (Permission):   TAKEN / SKIPPED → caregivers with can_view_medications
--
-- Key improvements over legacy trigger:
--   - Loops over caregiver_connections instead of caregiver_info LIMIT 1
--   - Respects per-caregiver permission flags
--   - Deduplicates escalation notifications within 2-minute window
--   - Preserves resolved_by (CAREGIVER) notification messaging

CREATE OR REPLACE FUNCTION public.handle_reminder_event_state_change()
RETURNS TRIGGER AS $$
DECLARE
  patient_uid UUID;
  patient_name TEXT;
  med_name TEXT;
  cg_rec RECORD;
  is_status_transition BOOLEAN;
BEGIN
  -- Determine if this is an actual status change
  IF TG_OP = 'INSERT' THEN
    is_status_transition := TRUE;
  ELSE
    is_status_transition := OLD.reminder_status IS DISTINCT FROM NEW.reminder_status;
  END IF;

  IF NOT is_status_transition THEN
    RETURN NEW;
  END IF;

  -- 1. Fetch medication and patient details
  SELECT drug_name INTO med_name FROM public.medications WHERE id = NEW.medication_id;
  SELECT id, full_name INTO patient_uid, patient_name
  FROM public.profiles
  WHERE telegram_chat_id = NEW.telegram_id;

  -- 2. Patient-Self Notifications (always delivered to patient)
  IF patient_uid IS NOT NULL THEN
    IF NEW.reminder_status = 'TAKEN' THEN
      IF NEW.resolved_by = 'CAREGIVER' THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (patient_uid, 'Medication Marked Taken', 
          'Your caregiver marked ' || COALESCE(med_name, 'your medication') || ' as taken.', 
          'TAKEN');
      ELSE
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (patient_uid, 'Medication Taken', 
          'You successfully took ' || COALESCE(med_name, 'your medication') || '.', 
          'TAKEN');
      END IF;

    ELSIF NEW.reminder_status = 'SKIPPED' THEN
      IF NEW.resolved_by = 'CAREGIVER' THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (patient_uid, 'Medication Marked Skipped', 
          'Your caregiver marked ' || COALESCE(med_name, 'your medication') || ' as skipped.', 
          'SKIPPED');
      ELSE
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (patient_uid, 'Medication Skipped', 
          'You skipped ' || COALESCE(med_name, 'your medication') || '.', 
          'SKIPPED');
      END IF;

    ELSIF NEW.reminder_status = 'MISSED' THEN
      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (patient_uid, 'Medication Dose Missed', 
        'You missed a scheduled dose of ' || COALESCE(med_name, 'your medication') || '.', 
        'MISSED');
    END IF;
  END IF;

  -- 3. Multi-Caregiver Fan-Out (Tiered Routing via caregiver_connections)
  FOR cg_rec IN (
    SELECT 
      cc.caregiver_profile_id,
      cc.is_primary,
      cc.can_view_medications,
      cc.can_receive_escalations
    FROM public.caregiver_connections cc
    WHERE cc.patient_profile_id = patient_uid
      AND cc.is_active = true
      AND cc.connection_status = 'ACCEPTED'
  ) LOOP

    -- Tier 1: Broadcast — Escalations (ESCALATED_TO_CG)
    IF NEW.reminder_status = 'ESCALATED_TO_CG' AND cg_rec.can_receive_escalations = true THEN
      -- Deduplicate escalations within 2-minute window
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
          'Critical Escalation Alert', 
          COALESCE(patient_name, 'Your patient') || ' has missed their scheduled dose of ' || COALESCE(med_name, 'medication') || '. Please verify.', 
          'ESCALATED'
        );
      END IF;

    -- Tier 1: Broadcast — Missed Doses
    ELSIF NEW.reminder_status = 'MISSED' AND cg_rec.can_receive_escalations = true THEN
      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (
        cg_rec.caregiver_profile_id, 
        'Dose Confirmed Missed', 
        COALESCE(patient_name, 'Patient') || ' completely missed their medication ' || COALESCE(med_name, 'medication') || '.', 
        'MISSED'
      );

    -- Tier 3: Permission-Based — Taken
    ELSIF NEW.reminder_status = 'TAKEN' AND cg_rec.can_view_medications = true THEN
      IF NEW.resolved_by = 'CAREGIVER' THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          cg_rec.caregiver_profile_id, 
          'Medication Marked Taken', 
          'You marked ' || COALESCE(patient_name, 'your patient') || '''s medication ' || COALESCE(med_name, 'medication') || ' as taken.', 
          'TAKEN'
        );
      ELSE
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          cg_rec.caregiver_profile_id, 
          'Medication Taken', 
          COALESCE(patient_name, 'Patient') || ' took ' || COALESCE(med_name, 'medication') || '.', 
          'TAKEN'
        );
      END IF;

    -- Tier 3: Permission-Based — Skipped
    ELSIF NEW.reminder_status = 'SKIPPED' AND cg_rec.can_view_medications = true THEN
      IF NEW.resolved_by = 'CAREGIVER' THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          cg_rec.caregiver_profile_id, 
          'Medication Marked Skipped', 
          'You marked ' || COALESCE(patient_name, 'your patient') || '''s medication ' || COALESCE(med_name, 'medication') || ' as skipped.', 
          'SKIPPED'
        );
      ELSE
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          cg_rec.caregiver_profile_id, 
          'Medication Skipped', 
          COALESCE(patient_name, 'Patient') || ' skipped ' || COALESCE(med_name, 'medication') || '.', 
          'SKIPPED'
        );
      END IF;
    END IF;

  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ensure the trigger is correctly attached (idempotent)
DROP TRIGGER IF EXISTS on_reminder_event_state_change ON public.reminder_events;

CREATE TRIGGER on_reminder_event_state_change
AFTER INSERT OR UPDATE ON public.reminder_events
FOR EACH ROW
EXECUTE FUNCTION public.handle_reminder_event_state_change();


-- ============================================================================
-- 4. RLS POLICIES FOR NOTIFICATIONS (connection_id aware)
-- ============================================================================
-- Ensure existing RLS policies still function correctly.
-- The connection_id column is nullable and only populated for access request notifications.
-- No RLS changes needed — existing user_id = auth.uid() policies remain correct.


COMMIT;
