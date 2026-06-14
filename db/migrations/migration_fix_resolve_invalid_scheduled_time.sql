-- Re-MIND-eЯ: resolve_reminder_event — don't re-validate a real event's time against current reminder_times
-- Migration: migration_fix_resolve_invalid_scheduled_time.sql
--
-- Bug: confirming/skipping a pending-review (UNCONFIRMED) dose threw INVALID_SCHEDULED_TIME after
-- the medication's reminder_times were edited. The RPC checked the event's scheduled_for (in the
-- med timezone, HH24:MI) against the CURRENT reminder_times. A historical event keeps its original
-- scheduled_for, so once the schedule is edited it no longer matches and becomes un-resolvable.
--
-- Fix: only validate reminder_times membership for VIRTUAL events (p_event_id null/<=0, i.e. a
-- client-computed dose we're inserting fresh). Real, already-persisted events are validated
-- against the actual reminder_events row (EVENT_NOT_FOUND / EVENT_ID_MISMATCH), so the time check
-- is unnecessary and harmful for them.

BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_reminder_event(p_event_id bigint, p_medication_id bigint, p_scheduled_for timestamp with time zone, p_action text, p_actor_role text DEFAULT NULL::text, p_resolution_channel text DEFAULT NULL::text)
 RETURNS TABLE(event_id bigint, reminder_status text, resolved_at timestamp with time zone, resolved_by text, log_id bigint, already_resolved boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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

  -- Only validate against current reminder_times for VIRTUAL events (no existing row).
  -- Real, already-persisted events keep their original scheduled_for even if the medication's
  -- reminder_times were later edited; re-validating would wrongly block resolving history.
  IF (p_event_id IS NULL OR p_event_id <= 0) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(coalesce(v_medication.reminder_times, '[]'::jsonb)) AS t(reminder_time)
      WHERE t.reminder_time = v_scheduled_time_text
    ) THEN
      RAISE EXCEPTION 'INVALID_SCHEDULED_TIME';
    END IF;
  END IF;

  -- ReBAC Authorization Check
  IF v_medication.telegram_id = v_profile_telegram_id THEN
    v_is_authorized := TRUE;
    v_target_telegram_id := v_medication.telegram_id;
    v_resolved_by := 'PATIENT';
    v_resolution_channel := coalesce(p_resolution_channel, 'WEB_DASHBOARD');
  ELSIF EXISTS (
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
$function$;

COMMIT;
