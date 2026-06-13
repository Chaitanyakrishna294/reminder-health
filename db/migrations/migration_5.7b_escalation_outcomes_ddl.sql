-- Migration: Sprint 5.7B Caregiver Escalation & Adherence Outcomes DDL
-- Run this in your Supabase SQL Editor to apply database schema changes.

-- 1. TEMPORARILY DROP TRANSITION VALIDATION TRIGGER
-- ============================================================================
DROP TRIGGER IF EXISTS trigger_validate_reminder_event_status_transition ON public.reminder_events;

-- 2. MIGRATE EXISTING DATA TO COMPATIBLE STATES
-- ============================================================================
UPDATE public.reminder_events 
SET reminder_status = 'SENT' 
WHERE reminder_status IN ('PENDING_PATIENT', 'RETRYING_PATIENT', 'SCHEDULED', 'SNOOZED');

UPDATE public.reminder_events 
SET reminder_status = 'ESCALATED' 
WHERE reminder_status = 'ESCALATED_TO_CG';

UPDATE public.reminder_events 
SET reminder_status = 'UNCONFIRMED' 
WHERE reminder_status = 'MISSED';

UPDATE public.reminder_events 
SET reminder_status = 'TAKEN', resolved_by = 'CAREGIVER_CONFIRMED' 
WHERE reminder_status = 'RESOLVED_BY_CG';

UPDATE public.reminder_events 
SET resolved_by = 'CAREGIVER_CONFIRMED' 
WHERE resolved_by = 'CAREGIVER';

-- 3. UPDATE TABLE SCHEMA AND AUDIT COLUMNS
-- ============================================================================
-- Add audit and telemetry columns to reminder_events
ALTER TABLE public.reminder_events ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE public.reminder_events ADD COLUMN IF NOT EXISTS reviewed_from_status TEXT;
ALTER TABLE public.reminder_events ADD COLUMN IF NOT EXISTS resolution_channel TEXT;

-- Add audit and telemetry columns to reminder_logs
ALTER TABLE public.reminder_logs ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE public.reminder_logs ADD COLUMN IF NOT EXISTS reviewed_from_status TEXT;
ALTER TABLE public.reminder_logs ADD COLUMN IF NOT EXISTS resolution_channel TEXT;
ALTER TABLE public.reminder_logs ADD COLUMN IF NOT EXISTS resolved_by TEXT;

-- Standardize default status for reminder_events
ALTER TABLE public.reminder_events ALTER COLUMN reminder_status SET DEFAULT 'SENT';

-- 4. APPLY CONSTRAINTS TO ENFORCE LIFE-CYCLE RULES
-- ============================================================================
-- Status check constraint on reminder_events
ALTER TABLE public.reminder_events DROP CONSTRAINT IF EXISTS reminder_events_reminder_status_check;
ALTER TABLE public.reminder_events ADD CONSTRAINT reminder_events_reminder_status_check
  CHECK (reminder_status IN ('SENT', 'DISPLAYED', 'OPENED', 'GENTLE_REMINDER', 'ESCALATED', 'CAREGIVER_ACKNOWLEDGED', 'PENDING_REVIEW', 'UNCONFIRMED', 'TAKEN', 'SKIPPED'));

-- Resolved_by check constraint on reminder_events
ALTER TABLE public.reminder_events DROP CONSTRAINT IF EXISTS reminder_events_resolved_by_check;
ALTER TABLE public.reminder_events ADD CONSTRAINT reminder_events_resolved_by_check
  CHECK (resolved_by IN ('PATIENT', 'CAREGIVER_CONFIRMED', 'SYSTEM'));

-- Resolved_by check constraint on reminder_logs
ALTER TABLE public.reminder_logs DROP CONSTRAINT IF EXISTS reminder_logs_resolved_by_check;
ALTER TABLE public.reminder_logs ADD CONSTRAINT reminder_logs_resolved_by_check
  CHECK (resolved_by IN ('PATIENT', 'CAREGIVER_CONFIRMED', 'SYSTEM'));

-- 5. CREATE PATIENT ESCALATION OPERATIONAL COOLDOWN TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.patient_escalation_state (
  patient_profile_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_escalated_at TIMESTAMPTZ,
  cooldown_until TIMESTAMPTZ
);

-- Enable RLS on patient_escalation_state
ALTER TABLE public.patient_escalation_state ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Patients select own escalation state" ON public.patient_escalation_state;
DROP POLICY IF EXISTS "Patients update own escalation state" ON public.patient_escalation_state;

-- Patients SELECT policy (own row only)
CREATE POLICY "Patients select own escalation state" ON public.patient_escalation_state
  FOR SELECT TO authenticated
  USING (auth.uid() = patient_profile_id);

-- Patients UPDATE policy (own row only)
CREATE POLICY "Patients update own escalation state" ON public.patient_escalation_state
  FOR UPDATE TO authenticated
  USING (auth.uid() = patient_profile_id)
  WITH CHECK (auth.uid() = patient_profile_id);

-- 6. UPDATE IN-APP NOTIFICATION TYPES CONSTRAINT
-- ============================================================================
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check 
CHECK (type IN (
  'TAKEN', 'SKIPPED', 'MISSED', 'ESCALATED', 
  'CARE_CIRCLE_ACCESS_REQUEST', 
  'CARE_CIRCLE_ACCESS_GRANTED', 
  'CARE_CIRCLE_ACCESS_UPDATED', 
  'CARE_CIRCLE_ACCESS_REVOKED', 
  'CARE_CIRCLE_PRIMARY_CHANGED',
  'UNCONFIRMED'
));

-- 7. REWRITE TRIGGER FUNCTION handle_reminder_event_state_change()
-- ============================================================================
CREATE OR REPLACE FUNCTION handle_reminder_event_state_change()
RETURNS TRIGGER AS $$
DECLARE
  patient_uid UUID;
  caregiver_uid UUID;
  med_name TEXT;
  patient_name TEXT;
  cg_chat_id TEXT;
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
  SELECT drug_name
  INTO med_name
  FROM public.medications
  WHERE id = NEW.medication_id;

  -- Resolve Patient UUID & Name
  SELECT id, full_name
  INTO patient_uid, patient_name
  FROM public.profiles
  WHERE telegram_chat_id = NEW.telegram_id;

  -- Resolve Caregiver Chat ID via active connection
  SELECT caregiver_chat_id
  INTO cg_chat_id
  FROM public.caregiver_info
  WHERE patient_telegram_id = NEW.telegram_id
    AND is_active = true
    AND connection_status = 'ACCEPTED'
  LIMIT 1;

  -- Resolve Caregiver Profile UUID
  IF cg_chat_id IS NOT NULL THEN
    SELECT id
    INTO caregiver_uid
    FROM public.profiles
    WHERE telegram_chat_id = cg_chat_id;
  END IF;

  -- 1. Handle TAKEN
  IF NEW.reminder_status = 'TAKEN' THEN
    IF NEW.resolved_by = 'CAREGIVER_CONFIRMED' THEN
      IF patient_uid IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          patient_uid,
          'Medication Marked Taken',
          'Your caregiver marked ' || COALESCE(med_name, 'your medication') || ' as taken.',
          'TAKEN'
        );
      END IF;

      IF caregiver_uid IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          caregiver_uid,
          'Medication Marked Taken',
          'You marked ' || COALESCE(patient_name, 'your patient') || '''s medication ' || COALESCE(med_name, 'medication') || ' as taken.',
          'TAKEN'
        );
      END IF;
    ELSE
      IF patient_uid IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          patient_uid,
          'Medication Taken',
          'You successfully took ' || COALESCE(med_name, 'your medication') || '.',
          'TAKEN'
        );
      END IF;

      IF caregiver_uid IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          caregiver_uid,
          'Medication Taken',
          COALESCE(patient_name, 'Patient') || ' took their medication ' || COALESCE(med_name, 'medication') || '.',
          'TAKEN'
        );
      END IF;
    END IF;

  -- 2. Handle SKIPPED
  ELSIF NEW.reminder_status = 'SKIPPED' THEN
    IF NEW.resolved_by = 'CAREGIVER_CONFIRMED' THEN
      IF patient_uid IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          patient_uid,
          'Medication Marked Skipped',
          'Your caregiver marked ' || COALESCE(med_name, 'your medication') || ' as skipped.',
          'SKIPPED'
        );
      END IF;

      IF caregiver_uid IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          caregiver_uid,
          'Medication Marked Skipped',
          'You marked ' || COALESCE(patient_name, 'your patient') || '''s medication ' || COALESCE(med_name, 'medication') || ' as skipped.',
          'SKIPPED'
        );
      END IF;
    ELSE
      IF patient_uid IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          patient_uid,
          'Medication Skipped',
          'You skipped ' || COALESCE(med_name, 'your medication') || '.',
          'SKIPPED'
        );
      END IF;

      IF caregiver_uid IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          caregiver_uid,
          'Medication Skipped',
          COALESCE(patient_name, 'Patient') || ' skipped their medication ' || COALESCE(med_name, 'medication') || '.',
          'SKIPPED'
        );
      END IF;
    END IF;

  -- 3. Handle ESCALATED (Caregiver alert stage)
  ELSIF NEW.reminder_status = 'ESCALATED' THEN
    IF caregiver_uid IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (
        caregiver_uid,
        '🚨 Medication Escalation Alert',
        'Alert: A critical medication for ' || COALESCE(patient_name, 'your patient') || ' (' || COALESCE(med_name, 'medication') || ') has not yet been confirmed.',
        'ESCALATED'
      );
    END IF;

  -- 4. Handle UNCONFIRMED (Daily closure stage)
  ELSIF NEW.reminder_status = 'UNCONFIRMED' THEN
    IF patient_uid IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (
        patient_uid,
        'Medication Review Required',
        'Help Us Complete Your Medication History: You have a pending review dose of ' || COALESCE(med_name, 'your medication') || ' from earlier today.',
        'UNCONFIRMED'
      );
    END IF;

    IF caregiver_uid IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (
        caregiver_uid,
        'Medication Dose Unconfirmed',
        'Dose Unconfirmed: ' || COALESCE(patient_name, 'Patient') || ' did not confirm taking their medication ' || COALESCE(med_name, 'medication') || ' today.',
        'UNCONFIRMED'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 8. REWRITE resolve_reminder_event() RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.resolve_reminder_event(
  p_event_id BIGINT,
  p_medication_id BIGINT,
  p_scheduled_for TIMESTAMPTZ,
  p_action TEXT,
  p_actor_role TEXT DEFAULT NULL,
  p_resolution_channel TEXT DEFAULT NULL
)
RETURNS TABLE (
  event_id BIGINT,
  reminder_status TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  log_id BIGINT,
  already_resolved BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_profile_id UUID;
  v_profile_telegram_id TEXT;
  v_medication public.medications%ROWTYPE;
  v_existing_event public.reminder_events%ROWTYPE;
  v_written_event public.reminder_events%ROWTYPE;
  v_existing_log_id BIGINT;
  v_actor_role TEXT;
  v_target_status TEXT;
  v_target_telegram_id TEXT;
  v_resolved_by TEXT;
  v_now TIMESTAMPTZ := now();
  v_delay_minutes INTEGER;
  v_scheduled_time_text TEXT;
  v_timezone TEXT;
  v_is_authorized BOOLEAN := FALSE;
  v_reviewed_at TIMESTAMPTZ := NULL;
  v_reviewed_from_status TEXT := NULL;
  v_resolution_channel TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  v_actor_role := upper(trim(coalesce(p_actor_role, '')));
  IF v_actor_role <> '' AND v_actor_role NOT IN ('PATIENT', 'CAREGIVER') THEN
    RAISE EXCEPTION 'INVALID_ACTOR_ROLE';
  END IF;

  IF p_action NOT IN ('TAKEN', 'SKIP') THEN
    RAISE EXCEPTION 'INVALID_ACTION';
  END IF;

  SELECT id, telegram_chat_id
  INTO v_profile_id, v_profile_telegram_id
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_profile_id IS NULL OR v_profile_telegram_id IS NULL THEN
    RAISE EXCEPTION 'PROFILE_NOT_LINKED';
  END IF;

  SELECT *
  INTO v_medication
  FROM public.medications
  WHERE id = p_medication_id
    AND active = true;

  IF v_medication.id IS NULL THEN
    RAISE EXCEPTION 'MEDICATION_NOT_FOUND';
  END IF;

  v_timezone := coalesce(nullif(v_medication.timezone, ''), 'Asia/Kolkata');
  v_scheduled_time_text := to_char(p_scheduled_for AT TIME ZONE v_timezone, 'HH24:MI');

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(coalesce(v_medication.reminder_times, '[]'::jsonb)) AS t(reminder_time)
    WHERE t.reminder_time = v_scheduled_time_text
  ) THEN
    RAISE EXCEPTION 'INVALID_SCHEDULED_TIME';
  END IF;

  -- ReBAC Authorization Check
  IF v_medication.telegram_id = v_profile_telegram_id THEN
    -- Self-Resolution: Caller owns the medication
    v_is_authorized := TRUE;
    v_target_telegram_id := v_medication.telegram_id;
    v_resolved_by := 'PATIENT';
    v_resolution_channel := coalesce(p_resolution_channel, 'WEB_DASHBOARD');
  ELSIF EXISTS (
    -- Caregiver-Resolution: Active connection in caregiver_connections
    SELECT 1
    FROM public.caregiver_connections cc
    JOIN public.profiles p_cg ON p_cg.id = cc.caregiver_profile_id
    JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id
    WHERE p_cg.telegram_chat_id = v_profile_telegram_id
      AND p_pat.telegram_chat_id = v_medication.telegram_id
      AND cc.is_active = true
      AND cc.connection_status = 'ACCEPTED'
      AND (cc.can_edit_medications = true OR cc.can_receive_escalations = true)
  ) OR EXISTS (
    -- Legacy caregiver_info lookup for bot actions fallback
    SELECT 1
    FROM public.caregiver_info ci
    WHERE ci.caregiver_chat_id = v_profile_telegram_id
      AND ci.patient_telegram_id = v_medication.telegram_id
      AND ci.is_active = true
      AND ci.connection_status = 'ACCEPTED'
  ) THEN
    v_is_authorized := TRUE;
    v_target_telegram_id := v_medication.telegram_id;
    v_resolved_by := 'CAREGIVER_CONFIRMED';
    v_resolution_channel := coalesce(p_resolution_channel, 'CAREGIVER_CONSOLE');
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF p_event_id IS NULL OR p_event_id <= 0 THEN
    IF (p_scheduled_for AT TIME ZONE v_timezone)::date <> (v_now AT TIME ZONE v_timezone)::date THEN
      RAISE EXCEPTION 'VIRTUAL_EVENT_MUST_BE_FOR_TODAY';
    END IF;
  END IF;

  v_target_status := CASE
    WHEN p_action = 'TAKEN' THEN 'TAKEN'
    ELSE 'SKIPPED'
  END;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_medication_id::TEXT || '|' || p_scheduled_for::TEXT, 0));

  SELECT *
  INTO v_existing_event
  FROM public.reminder_events
  WHERE medication_id = p_medication_id
    AND scheduled_for = p_scheduled_for
  FOR UPDATE;

  IF p_event_id IS NOT NULL AND p_event_id > 0 THEN
    IF v_existing_event.id IS NULL THEN
      RAISE EXCEPTION 'EVENT_NOT_FOUND';
    END IF;

    IF v_existing_event.id <> p_event_id THEN
      RAISE EXCEPTION 'EVENT_ID_MISMATCH';
    END IF;
  END IF;

  IF v_existing_event.id IS NOT NULL THEN
    IF v_existing_event.telegram_id <> v_target_telegram_id THEN
      RAISE EXCEPTION 'EVENT_MEDICATION_MISMATCH';
    END IF;

    -- If already resolved in a final status, return existing details
    IF v_existing_event.reminder_status IN ('TAKEN', 'SKIPPED') THEN
      SELECT id
      INTO v_existing_log_id
      FROM public.reminder_logs
      WHERE medication_id = p_medication_id
        AND scheduled_time = p_scheduled_for
      ORDER BY id
      LIMIT 1;

      RETURN QUERY
      SELECT
        v_existing_event.id,
        v_existing_event.reminder_status,
        v_existing_event.resolved_at,
        v_existing_event.resolved_by,
        v_existing_log_id,
        TRUE;
      RETURN;
    END IF;

    -- If event status is UNCONFIRMED, set late review audit trail
    IF v_existing_event.reminder_status = 'UNCONFIRMED' THEN
      v_reviewed_at := v_now;
      v_reviewed_from_status := 'UNCONFIRMED';
      v_resolution_channel := coalesce(p_resolution_channel, 'REVIEW_QUEUE');
    END IF;

    UPDATE public.reminder_events
    SET
      reminder_status = v_target_status,
      resolved_at = v_now,
      resolved_by = v_resolved_by,
      retry_reminder_at = NULL,
      retry_count = 0,
      reviewed_at = v_reviewed_at,
      reviewed_from_status = v_reviewed_from_status,
      resolution_channel = v_resolution_channel
    WHERE id = v_existing_event.id
    RETURNING *
    INTO v_written_event;
  ELSE
    -- Virtual event resolution (inserts new record directly)
    INSERT INTO public.reminder_events (
      medication_id,
      telegram_id,
      scheduled_for,
      reminder_status,
      retry_count,
      retry_reminder_at,
      snooze_count,
      resolved_at,
      resolved_by,
      reviewed_at,
      reviewed_from_status,
      resolution_channel
    )
    VALUES (
      p_medication_id,
      v_target_telegram_id,
      p_scheduled_for,
      v_target_status,
      0,
      NULL,
      0,
      v_now,
      v_resolved_by,
      v_reviewed_at,
      v_reviewed_from_status,
      v_resolution_channel
    )
    RETURNING *
    INTO v_written_event;
  END IF;

  IF p_action = 'TAKEN' THEN
    v_delay_minutes := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_now - p_scheduled_for)) / 60))::INTEGER;
  ELSE
    v_delay_minutes := NULL;
  END IF;

  SELECT id
  INTO v_existing_log_id
  FROM public.reminder_logs
  WHERE medication_id = p_medication_id
    AND scheduled_time = p_scheduled_for
  ORDER BY id
  LIMIT 1;

  IF v_existing_log_id IS NULL THEN
    INSERT INTO public.reminder_logs (
      telegram_id,
      medication_id,
      scheduled_time,
      response,
      responded_at,
      delay_minutes,
      resolved_by,
      reviewed_at,
      reviewed_from_status,
      resolution_channel
    )
    VALUES (
      v_target_telegram_id,
      p_medication_id,
      p_scheduled_for,
      p_action,
      v_now,
      v_delay_minutes,
      v_resolved_by,
      v_reviewed_at,
      v_reviewed_from_status,
      v_resolution_channel
    )
    RETURNING id
    INTO v_existing_log_id;
  ELSE
    UPDATE public.reminder_logs
    SET
      response = p_action,
      responded_at = v_now,
      delay_minutes = v_delay_minutes,
      resolved_by = v_resolved_by,
      reviewed_at = v_reviewed_at,
      reviewed_from_status = v_reviewed_from_status,
      resolution_channel = v_resolution_channel
    WHERE id = v_existing_log_id;
  END IF;

  RETURN QUERY
  SELECT
    v_written_event.id,
    v_written_event.reminder_status,
    v_written_event.resolved_at,
    v_written_event.resolved_by,
    v_existing_log_id,
    FALSE;
END;
$$;

-- 9. RE-DEFINE AND RE-CREATE TRANSITION VALIDATION TRIGGER WITH NEW COOLDOWN RULES
-- ============================================================================
-- Redefine validate_reminder_event_status_transition function to reflect the new final states
CREATE OR REPLACE FUNCTION public.validate_reminder_event_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- If status is not changing, allow it
  IF OLD.reminder_status = NEW.reminder_status THEN
    RETURN NEW;
  END IF;

  -- Once status is in a final state (TAKEN, SKIPPED), it cannot transition.
  -- ('UNCONFIRMED' is no longer a final state, it can transition to TAKEN or SKIPPED)
  IF OLD.reminder_status IN ('TAKEN', 'SKIPPED') THEN
    RAISE EXCEPTION 'Forbidden transition: cannot change status from final state % to %', OLD.reminder_status, NEW.reminder_status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger
CREATE TRIGGER trigger_validate_reminder_event_status_transition
BEFORE UPDATE ON public.reminder_events
FOR EACH ROW
EXECUTE FUNCTION public.validate_reminder_event_status_transition();
