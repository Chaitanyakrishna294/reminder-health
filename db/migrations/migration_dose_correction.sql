-- RE-MIND-eЯ: Same-day dose correction (Taken ↔ Skipped). 2026-06.
-- Idempotent — safe to re-run in the Supabase SQL Editor.
-- ============================================================================

-- ============================================================================
-- 1. Allow TAKEN ↔ SKIPPED corrections; still block any other exit from a final state.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.validate_reminder_event_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.reminder_status = NEW.reminder_status THEN
    RETURN NEW;
  END IF;

  IF OLD.reminder_status IN ('TAKEN', 'SKIPPED') THEN
    -- Permit a correction between the two final outcomes…
    IF NEW.reminder_status IN ('TAKEN', 'SKIPPED') THEN
      RETURN NEW;
    END IF;
    -- …but nothing else may leave a final state.
    RAISE EXCEPTION 'Forbidden transition: cannot change status from final state % to %', OLD.reminder_status, NEW.reminder_status;
  END IF;

  RETURN NEW;
END;
$function$;


-- ============================================================================
-- 2. correct_reminder_event — flip an already-resolved dose to the other outcome
--    (same calendar day only). Mirrors resolve_reminder_event's auth + locking.
-- ============================================================================
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

  -- Authorization: patient owns the med, or an accepted caregiver connection exists.
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
  ) OR EXISTS (
    SELECT 1 FROM public.caregiver_info ci
    WHERE ci.caregiver_chat_id = v_profile_telegram_id
      AND ci.patient_telegram_id = v_medication.telegram_id
      AND ci.is_active = true AND ci.connection_status = 'ACCEPTED'
  ) THEN
    v_is_authorized := TRUE;
    v_resolved_by := 'CAREGIVER_CONFIRMED';
  END IF;

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

  -- No-op if it's already the requested outcome.
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
