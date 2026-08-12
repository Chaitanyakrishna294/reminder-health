-- Rollback for migration_past_day_correction_2026_08_12.sql
-- Restores correct_reminder_event to the SAME-DAY-ONLY behaviour that
-- migration_dose_correction.sql defined. Idempotent.
--
-- WHAT REVERTING COSTS: the day rail's past days become read-only. Any dose already
-- corrected on a past day STAYS corrected — this only closes the door, it does not
-- rewind the record. That is the right direction: a family's "she did take it" is a
-- fact they asserted, and a rollback of a function should never silently un-assert it.
--
-- The web UI degrades honestly rather than breaking: past-day Change buttons will
-- start failing with CORRECTION_WINDOW_EXPIRED, which the client already surfaces as
-- "Doses can only be corrected on the same day."
--
-- CREATE OR REPLACE only — never DROP+CREATE on a scheduler-adjacent function.

CREATE OR REPLACE FUNCTION public.correct_reminder_event(
  p_event_id bigint,
  p_medication_id bigint,
  p_scheduled_for timestamptz,
  p_action text,
  p_actor_role text DEFAULT NULL
)
RETURNS TABLE(event_id bigint, reminder_status text, resolved_at timestamptz, resolved_by text, log_id bigint, already_resolved boolean)
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
  v_target_status TEXT;
  v_resolved_by TEXT;
  v_now TIMESTAMPTZ := now();
  v_timezone TEXT;
  v_delay_minutes INTEGER;
  v_is_authorized BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF p_action NOT IN ('TAKEN', 'SKIP') THEN
    RAISE EXCEPTION 'INVALID_ACTION';
  END IF;

  SELECT id, telegram_chat_id INTO v_profile_id, v_profile_telegram_id
  FROM public.profiles WHERE id = auth.uid();
  IF v_profile_id IS NULL OR v_profile_telegram_id IS NULL THEN
    RAISE EXCEPTION 'PROFILE_NOT_LINKED';
  END IF;

  SELECT * INTO v_medication FROM public.medications WHERE id = p_medication_id;
  IF v_medication.id IS NULL THEN
    RAISE EXCEPTION 'MEDICATION_NOT_FOUND';
  END IF;

  v_timezone := coalesce(nullif(v_medication.timezone, ''), 'Asia/Kolkata');

  -- Same-day-only correction window.
  IF (p_scheduled_for AT TIME ZONE v_timezone)::date <> (v_now AT TIME ZONE v_timezone)::date THEN
    RAISE EXCEPTION 'CORRECTION_WINDOW_EXPIRED';
  END IF;

  IF v_medication.telegram_id = v_profile_telegram_id THEN
    v_is_authorized := TRUE;
    v_resolved_by := 'PATIENT';
  ELSIF EXISTS (
    SELECT 1 FROM public.caregiver_connections cc
    JOIN public.profiles p_cg ON p_cg.id = cc.caregiver_profile_id
    JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id
    WHERE p_cg.telegram_chat_id = v_profile_telegram_id
      AND p_pat.telegram_chat_id = v_medication.telegram_id
      AND cc.is_active = true AND cc.connection_status = 'ACCEPTED'
      AND (cc.can_edit_medications = true OR cc.can_receive_escalations = true)
  ) THEN
    v_is_authorized := TRUE;
    v_resolved_by := 'CAREGIVER_CONFIRMED';
  END IF;

  -- NOTE: the legacy caregiver_info branch was removed by
  -- migration_caregiver_legacy_branch_gated_2026_08_11.sql and is deliberately NOT
  -- restored here. Rolling back the correction window must not reopen an RLS bypass.

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  v_target_status := CASE WHEN p_action = 'TAKEN' THEN 'TAKEN' ELSE 'SKIPPED' END;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_medication_id::TEXT || '|' || p_scheduled_for::TEXT, 0));

  SELECT * INTO v_existing_event
  FROM public.reminder_events
  WHERE medication_id = p_medication_id AND scheduled_for = p_scheduled_for
  FOR UPDATE;

  -- Only an already-resolved dose can be corrected.
  IF v_existing_event.id IS NULL OR v_existing_event.reminder_status NOT IN ('TAKEN', 'SKIPPED') THEN
    RAISE EXCEPTION 'EVENT_NOT_RESOLVED';
  END IF;

  IF p_event_id IS NOT NULL AND p_event_id > 0 AND v_existing_event.id <> p_event_id THEN
    RAISE EXCEPTION 'EVENT_ID_MISMATCH';
  END IF;

  IF v_existing_event.reminder_status = v_target_status THEN
    SELECT id INTO v_existing_log_id FROM public.reminder_logs
    WHERE medication_id = p_medication_id AND scheduled_time = p_scheduled_for ORDER BY id LIMIT 1;
    RETURN QUERY SELECT v_existing_event.id, v_existing_event.reminder_status, v_existing_event.resolved_at,
                        v_existing_event.resolved_by, v_existing_log_id, TRUE;
    RETURN;
  END IF;

  UPDATE public.reminder_events
  SET reminder_status = v_target_status, resolved_at = v_now, resolved_by = v_resolved_by,
      reviewed_at = v_now, reviewed_from_status = v_existing_event.reminder_status,
      resolution_channel = 'CORRECTION'
  WHERE id = v_existing_event.id
  RETURNING * INTO v_written_event;

  IF p_action = 'TAKEN' THEN
    v_delay_minutes := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_now - p_scheduled_for)) / 60))::INTEGER;
  ELSE
    v_delay_minutes := NULL;
  END IF;

  SELECT id INTO v_existing_log_id FROM public.reminder_logs
  WHERE medication_id = p_medication_id AND scheduled_time = p_scheduled_for ORDER BY id LIMIT 1;

  IF v_existing_log_id IS NULL THEN
    INSERT INTO public.reminder_logs (telegram_id, medication_id, scheduled_time, response, responded_at,
      delay_minutes, resolved_by, reviewed_at, reviewed_from_status, resolution_channel)
    VALUES (v_medication.telegram_id, p_medication_id, p_scheduled_for, p_action, v_now,
      v_delay_minutes, v_resolved_by, v_now, v_existing_event.reminder_status, 'CORRECTION')
    RETURNING id INTO v_existing_log_id;
  ELSE
    UPDATE public.reminder_logs
    SET response = p_action, responded_at = v_now, delay_minutes = v_delay_minutes,
        resolved_by = v_resolved_by, reviewed_at = v_now,
        reviewed_from_status = v_existing_event.reminder_status, resolution_channel = 'CORRECTION'
    WHERE id = v_existing_log_id;
  END IF;

  RETURN QUERY SELECT v_written_event.id, v_written_event.reminder_status, v_written_event.resolved_at,
                      v_written_event.resolved_by, v_existing_log_id, FALSE;
END;
$function$;

REVOKE ALL ON FUNCTION public.correct_reminder_event(bigint, bigint, timestamptz, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_reminder_event(bigint, bigint, timestamptz, text, text) TO authenticated;
