-- Re-MIND-eЯ Sprint 5.7B: Unified User Model & ReBAC Onboarding Transition
-- Migration Script: migration_remove_role_onboarding.sql
-- Run this in your Supabase SQL Editor.

BEGIN;

-- ============================================================================
-- 1. UPDATE handle_reminder_event_state_change() TRIGGER FUNCTION
-- ============================================================================
-- Redefine notification trigger to resolve profiles purely by telegram_chat_id
CREATE OR REPLACE FUNCTION public.handle_reminder_event_state_change()
RETURNS TRIGGER AS $$
DECLARE
  patient_uid UUID;
  caregiver_uid UUID;
  med_name TEXT;
  patient_name TEXT;
  cg_chat_id TEXT;
  is_status_transition BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    is_status_transition := TRUE;
  ELSE
    is_status_transition := OLD.reminder_status IS DISTINCT FROM NEW.reminder_status;
  END IF;

  IF NOT is_status_transition THEN
    RETURN NEW;
  END IF;

  SELECT drug_name
  INTO med_name
  FROM public.medications
  WHERE id = NEW.medication_id;

  -- Resolve Patient: Omit role checks so any user profile matching chat ID is targeted
  SELECT id, full_name
  INTO patient_uid, patient_name
  FROM public.profiles
  WHERE telegram_chat_id = NEW.telegram_id;

  SELECT caregiver_chat_id
  INTO cg_chat_id
  FROM public.caregiver_info
  WHERE patient_telegram_id = NEW.telegram_id
    AND is_active = true
    AND connection_status = 'ACCEPTED'
  LIMIT 1;

  -- Resolve Caregiver: Omit role checks so any user profile matching chat ID is targeted
  IF cg_chat_id IS NOT NULL THEN
    SELECT id
    INTO caregiver_uid
    FROM public.profiles
    WHERE telegram_chat_id = cg_chat_id;
  END IF;

  IF NEW.reminder_status = 'TAKEN' THEN
    IF NEW.resolved_by = 'CAREGIVER' THEN
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
  ELSIF NEW.reminder_status = 'SKIPPED' THEN
    IF NEW.resolved_by = 'CAREGIVER' THEN
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
  ELSIF NEW.reminder_status = 'ESCALATED_TO_CG' THEN
    IF caregiver_uid IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (
        caregiver_uid,
        'Critical Escalation Alert',
        COALESCE(patient_name, 'Your patient') || ' has missed their scheduled dose of ' || COALESCE(med_name, 'medication') || '. Please verify.',
        'ESCALATED'
      );
    END IF;
  ELSIF NEW.reminder_status = 'MISSED' THEN
    IF patient_uid IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (
        patient_uid,
        'Medication Dose Missed',
        'You missed a scheduled dose of ' || COALESCE(med_name, 'your medication') || '.',
        'MISSED'
      );
    END IF;

    IF caregiver_uid IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (
        caregiver_uid,
        'Dose Confirmed Missed',
        COALESCE(patient_name, 'Patient') || ' completely missed their medication ' || COALESCE(med_name, 'medication') || '.',
        'MISSED'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 2. REWRITE resolve_reminder_event() RPC AUTHORIZATION
-- ============================================================================
-- Redefine resolution RPC to perform relationship-based validation (ReBAC)
CREATE OR REPLACE FUNCTION public.resolve_reminder_event(
  p_event_id BIGINT,
  p_medication_id BIGINT,
  p_scheduled_for TIMESTAMPTZ,
  p_action TEXT,
  p_actor_role TEXT DEFAULT NULL
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
    v_resolved_by := 'CAREGIVER';
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

    IF v_existing_event.reminder_status IN ('TAKEN', 'SKIPPED', 'RESOLVED_BY_CG', 'MISSED') THEN
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

    IF v_existing_event.reminder_status NOT IN (
      'PENDING_PATIENT',
      'RETRYING_PATIENT',
      'SNOOZED',
      'ESCALATED_TO_CG',
      'FUTURE_SCHEDULED'
    ) THEN
      RAISE EXCEPTION 'INVALID_EVENT_STATUS';
    END IF;

    UPDATE public.reminder_events
    SET
      reminder_status = v_target_status,
      resolved_at = v_now,
      resolved_by = v_resolved_by,
      retry_reminder_at = NULL,
      retry_count = 0
    WHERE id = v_existing_event.id
    RETURNING *
    INTO v_written_event;
  ELSE
    INSERT INTO public.reminder_events (
      medication_id,
      telegram_id,
      scheduled_for,
      reminder_status,
      retry_count,
      retry_reminder_at,
      snooze_count,
      resolved_at,
      resolved_by
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
      v_resolved_by
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
      delay_minutes
    )
    VALUES (
      v_target_telegram_id,
      p_medication_id,
      p_scheduled_for,
      p_action,
      v_now,
      v_delay_minutes
    )
    RETURNING id
    INTO v_existing_log_id;
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


-- ============================================================================
-- 3. DECOUPLE LEGACY RLS POLICIES FROM profiles.role COLUMN
-- ============================================================================

-- 3a. Medications View Policy
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
      
      -- Dual-Read Legacy Path (backward compatibility, profiles.role check removed)
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND ci.is_active = true AND ci.connection_status = 'ACCEPTED'
    )
  );

-- 3b. Reminder Events View Policy
DROP POLICY IF EXISTS "Caregivers view patient events" ON public.reminder_events;
CREATE POLICY "Caregivers view patient events" ON public.reminder_events
  FOR SELECT TO authenticated
  USING (
    telegram_id IN (
      SELECT p_pat.telegram_chat_id 
      FROM public.caregiver_connections cc
      JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id
      WHERE cc.caregiver_profile_id = auth.uid() 
        AND cc.is_active = true 
        AND cc.connection_status = 'ACCEPTED'
        AND cc.can_view_medications = true
      
      UNION
      
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND ci.is_active = true AND ci.connection_status = 'ACCEPTED'
    )
  );

-- 3c. Reminder Events Resolve Policy
DROP POLICY IF EXISTS "Caregivers resolve patient events" ON public.reminder_events;
CREATE POLICY "Caregivers resolve patient events" ON public.reminder_events
  FOR UPDATE TO authenticated
  USING (
    telegram_id IN (
      SELECT p_pat.telegram_chat_id 
      FROM public.caregiver_connections cc
      JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id
      WHERE cc.caregiver_profile_id = auth.uid() 
        AND cc.is_active = true 
        AND cc.connection_status = 'ACCEPTED'
        AND (cc.can_edit_medications = true OR cc.can_receive_escalations = true)
      
      UNION
      
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND ci.is_active = true AND ci.connection_status = 'ACCEPTED'
    )
  );

-- 3d. Reminder Logs View Policy
DROP POLICY IF EXISTS "Caregivers view patient logs" ON public.reminder_logs;
CREATE POLICY "Caregivers view patient logs" ON public.reminder_logs
  FOR SELECT TO authenticated
  USING (
    telegram_id IN (
      SELECT p_pat.telegram_chat_id 
      FROM public.caregiver_connections cc
      JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id
      WHERE cc.caregiver_profile_id = auth.uid() 
        AND cc.is_active = true 
        AND cc.connection_status = 'ACCEPTED'
        AND cc.can_view_reports = true
      
      UNION
      
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND ci.is_active = true AND ci.connection_status = 'ACCEPTED'
    )
  );

-- 3e. Reminder Logs Insert Policy
DROP POLICY IF EXISTS "Caregivers insert patient logs" ON public.reminder_logs;
CREATE POLICY "Caregivers insert patient logs" ON public.reminder_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    telegram_id IN (
      SELECT p_pat.telegram_chat_id 
      FROM public.caregiver_connections cc
      JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id
      WHERE cc.caregiver_profile_id = auth.uid() 
        AND cc.is_active = true 
        AND cc.connection_status = 'ACCEPTED'
        AND (cc.can_edit_medications = true OR cc.can_receive_escalations = true)
      
      UNION
      
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND ci.is_active = true AND ci.connection_status = 'ACCEPTED'
    )
  );

COMMIT;
