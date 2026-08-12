-- RE-MIND-eЯ: past-day dose correction (the rail's date row). 2026-08-12.
-- Idempotent — safe to re-run in the Supabase SQL Editor.
-- ============================================================================
--
-- WHY
-- The day rail can now show the last 7 days. A family looking at yesterday must be
-- able to record what actually happened — "she did take the 9pm one, I watched her"
-- — instead of leaving a permanent MISSED that was never true. This is RECORD
-- CORRECTION, not dosing: it changes the history, never a schedule, never an alarm.
--
-- WHAT CHANGES, and nothing else:
--   1. The correction window widens from SAME DAY to the last 7 days, still measured
--      in the MEDICATION's timezone (unchanged mechanism, wider bound).
--   2. FUTURE doses are refused explicitly, server-side. The UI does not offer future
--      days at all, but "not offered" is not a guard — a guard is a guard.
--   3. On a PAST day, an unanswered dose (MISSED / PENDING_REVIEW / UNCONFIRMED /
--      ESCALATED_TO_CG) becomes correctable. TODAY keeps the old rule exactly:
--      only an already-resolved TAKEN/SKIPPED may be corrected, because today's
--      unanswered doses belong to resolve_reminder_event — the dose gate and the
--      rail's due-now card are the one path for those, and CLAUDE.md's
--      never-disagree invariant depends on it staying that way.
--   4. A backfill records delay_minutes = NULL rather than the minutes between the
--      dose and the correction. Writing "1,840 minutes late" for a dose someone
--      confirms the next morning is a fabricated measurement: we know WHAT happened,
--      not WHEN. Same-day corrections keep their existing delay, which is real.
--
-- WHAT DOES NOT CHANGE
--   * No escalation is started, resumed or cancelled here. This function writes
--     reminder_events + reminder_logs and nothing else; the ladder is driven by the
--     bot polling retry_reminder_at, and moving a dose INTO TAKEN/SKIPPED ends it
--     rather than beginning it. Correcting a stale ESCALATED_TO_CG row is therefore
--     strictly de-escalating.
--   * The alarm core is untouched. Device alarms are registered from the local Room
--     store off reminder_times; nothing here writes a schedule.
--   * The status-transition trigger is NOT modified. It already permits
--     TAKEN <-> SKIPPED and any exit from a non-final state, which is exactly the
--     set this migration needs. Left alone on purpose: it is the last thing standing
--     between a bug and a rewritten adherence history.
--   * The stock trigger (trigger_reminder_event_taken_stock_reduction) fires as it
--     always has. Correcting MISSED -> TAKEN decrements stock, which is correct: the
--     pill left the box. This is the same auto-compensation the same-day correction
--     has always relied on.
--
-- CREATE OR REPLACE only — never DROP+CREATE on a scheduler-adjacent function.
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
  v_delay_minutes INTEGER;
  v_is_authorized BOOLEAN := FALSE;
  v_timezone TEXT;
  v_dose_date DATE;
  v_today DATE;
  v_days_back INTEGER;
  v_is_past_day BOOLEAN;
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

  -- Both dates in the MEDICATION's zone. This is the same comparison the web client
  -- makes when it decides which day a dose is filed under (dayKeyForDose), and the
  -- two must agree: if they disagree the UI offers a Change the server then refuses,
  -- which surfaces only at the moment someone is trying to repair their record.
  v_dose_date := (p_scheduled_for AT TIME ZONE v_timezone)::date;
  v_today     := (v_now AT TIME ZONE v_timezone)::date;
  v_days_back := v_today - v_dose_date;
  v_is_past_day := v_days_back > 0;

  -- A dose that has not happened yet cannot have an outcome. Refused here rather
  -- than relying on the UI not offering future days.
  IF v_days_back < 0 THEN
    RAISE EXCEPTION 'CANNOT_CORRECT_FUTURE_DOSE';
  END IF;

  -- 7 days back, matching the rail's date row. Beyond that the record is closed:
  -- an unbounded window would let a months-old adherence history be rewritten long
  -- after anyone could remember whether it was true.
  IF v_days_back > 7 THEN
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
  ) THEN
    v_is_authorized := TRUE;
    v_resolved_by := 'CAREGIVER_CONFIRMED';
  END IF;

  -- NOTE: the legacy caregiver_info branch that used to sit here was REMOVED by
  -- migration_caregiver_legacy_branch_gated_2026_08_11.sql, which found it granted
  -- access regardless of the patient's can_* toggles. Do not reintroduce it.

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  v_target_status := CASE WHEN p_action = 'TAKEN' THEN 'TAKEN' ELSE 'SKIPPED' END;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_medication_id::TEXT || '|' || p_scheduled_for::TEXT, 0));

  SELECT * INTO v_existing_event
  FROM public.reminder_events
  WHERE medication_id = p_medication_id AND scheduled_for = p_scheduled_for
  FOR UPDATE;

  IF v_existing_event.id IS NULL THEN
    RAISE EXCEPTION 'EVENT_NOT_RESOLVED';
  END IF;

  -- TODAY: unchanged — only an already-resolved dose may be corrected. Today's
  -- unanswered doses go through resolve_reminder_event, which is what keeps the dose
  -- gate and the rail's due-now card asking about the same dose.
  --
  -- A PAST DAY: an unanswered dose may be answered, because nothing else will ever
  -- answer it. That is the whole point of the feature — a MISSED row from yesterday
  -- that was not actually missed is a false record, and leaving it standing because
  -- the deadline passed is the app choosing its own bookkeeping over the truth.
  IF v_is_past_day THEN
    IF v_existing_event.reminder_status NOT IN
       ('TAKEN', 'SKIPPED', 'MISSED', 'PENDING_REVIEW', 'UNCONFIRMED', 'ESCALATED_TO_CG') THEN
      RAISE EXCEPTION 'EVENT_NOT_CORRECTABLE';
    END IF;
  ELSE
    IF v_existing_event.reminder_status NOT IN ('TAKEN', 'SKIPPED') THEN
      RAISE EXCEPTION 'EVENT_NOT_RESOLVED';
    END IF;
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

  -- retry_reminder_at is cleared so a corrected dose cannot be picked up by the
  -- escalation poller after the fact. Correcting a stale ESCALATED_TO_CG row is
  -- de-escalation; leaving a retry timestamp behind would let the ladder re-fire for
  -- a dose that has just been answered.
  UPDATE public.reminder_events
  SET reminder_status = v_target_status, resolved_at = v_now, resolved_by = v_resolved_by,
      reviewed_at = v_now, reviewed_from_status = v_existing_event.reminder_status,
      resolution_channel = 'CORRECTION',
      retry_reminder_at = NULL
  WHERE id = v_existing_event.id
  RETURNING * INTO v_written_event;

  -- "How late" is only meaningful for a dose corrected on its own day. A backfill
  -- says WHAT happened, not WHEN — recording the gap between the dose and the
  -- correction would invent a measurement nobody took.
  IF p_action = 'TAKEN' AND NOT v_is_past_day THEN
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
