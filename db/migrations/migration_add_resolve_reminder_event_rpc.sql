-- Deployment 1, phase 2: add a single atomic reminder resolution RPC for dashboard writes.

BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_reminder_event(
  p_event_id BIGINT,
  p_medication_id BIGINT,
  p_scheduled_for TIMESTAMPTZ,
  p_action TEXT,
  p_actor_role TEXT
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
  IF v_actor_role NOT IN ('PATIENT', 'CAREGIVER') THEN
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

  IF v_actor_role = 'PATIENT' THEN
    IF v_medication.telegram_id = v_profile_telegram_id THEN
      v_is_authorized := TRUE;
      v_target_telegram_id := v_medication.telegram_id;
      v_resolved_by := 'PATIENT';
    END IF;
  ELSE
    IF EXISTS (
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

REVOKE ALL ON FUNCTION public.resolve_reminder_event(BIGINT, BIGINT, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_reminder_event(BIGINT, BIGINT, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;

COMMIT;
