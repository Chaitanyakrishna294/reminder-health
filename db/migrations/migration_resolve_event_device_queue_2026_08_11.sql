-- Re-MIND-eЯ: resolve_reminder_event — let the Android offline action queue actually sync
-- Migration: migration_resolve_event_device_queue_2026_08_11.sql
--
-- CONTEXT (M2 step 6, CLAUDE.md). The Android alarm core records Taken/Skip locally the instant
-- the patient taps, then drains that queue through this RPC when there is network. It CANNOT send
-- p_event_id: the alarm is pure native and fires with no server round-trip, so all it knows is
-- (medication_id, scheduled_for). Every device action therefore arrives on the "virtual event"
-- path.
--
-- BUG. Two guards on that path are gated on `p_event_id IS NULL` — i.e. on "the caller did not
-- supply an id" — when what they actually mean is "we are about to fabricate a dose row that no
-- server process ever created". For the web those are the same thing. For the device they are not,
-- and the result is two ways a patient's recorded dose is thrown away:
--
--   1. VIRTUAL_EVENT_MUST_BE_FOR_TODAY — any action that syncs after the medication's local day
--      rolls over is rejected forever. A dose taken at 23:50 with the phone offline overnight is
--      the exact case the offline queue exists for, and it was the one case guaranteed to fail.
--   2. INVALID_SCHEDULED_TIME — the dose's time is re-checked against the medication's CURRENT
--      reminder_times, so editing the schedule between the alarm firing and the queue draining
--      permanently orphans the queued answer. This is the same bug
--      migration_fix_resolve_invalid_scheduled_time.sql already fixed for real events; the device
--      re-opens it purely because it cannot pass an id.
--
-- Both are permanent failures: the device retries 5 times, gives up, and the patient's "I took it"
-- is silently gone. In a medication record that is data loss.
--
-- FIX. Decide which case we are in by looking for the reminder_events row FIRST, then gate the two
-- guards on `v_existing_event.id IS NULL` — a genuine fresh insert — rather than on whether the
-- caller happened to know an id. Resolving a row that a server process really created is safe
-- regardless of its date or of later schedule edits; that is exactly what the p_event_id path
-- already did.
--
-- The insert path keeps a bound, because unbounded backfill is the real thing that guard was
-- protecting against (a client fabricating adherence history). "Same local date" is replaced by a
-- 48h window: long enough for a phone offline overnight and through the next day, and the longer
-- the delay runs the more certain it is that the server pipeline created the row anyway, which
-- takes the no-bound existing-row path. A small forward grace absorbs device clock skew.
--
-- The exception NAME is deliberately left as VIRTUAL_EVENT_MUST_BE_FOR_TODAY even though it now
-- means "outside the backfill window". web/src/components/dashboard/med-due-gate.tsx matches these
-- codes as strings in PERMANENT_RPC_ERRORS to decide whether to stop asking and tell the patient
-- the dose will show as missed. Renaming it would turn a permanent error into a silently retried
-- one for any client not deployed in lockstep. The name is historical; the meaning is in this file.
--
-- NOT CHANGED: the ReBAC authorization rules, the UNCONFIRMED review stamping, resolution_channel
-- defaults, the reminder_logs upsert, and the return shape are all carried over verbatim.
-- Authorization still runs before the advisory lock and before any write. What moved is only
-- WHERE the row lookup sits relative to the two guards.
--
-- WEB BEHAVIOR IS UNAFFECTED IN PRACTICE: dashboard-client-view.tsx only ever generates virtual
-- doses for today, so it never reaches the widened window; and its virtual doses have no existing
-- row, so both guards still apply to it exactly as before.
--
-- Apply in the Supabase SQL editor, then run
-- db/validations/validation_resolve_event_device_queue_2026_08_11.sql (every row should read DONE).

BEGIN;

-- CREATE OR REPLACE, never DROP + CREATE. A DROP resets the ACL to the default PUBLIC EXECUTE,
-- which has already silently re-exposed scheduler-adjacent functions in this repo's history (see
-- APPLIED.md's lockdown note). This function has no GRANT block of its own to re-run — it relies
-- on the grants made when it was first created — so a DROP here would be especially quiet.
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
  -- How far back a dose row may be fabricated from scratch. See the header: this
  -- bounds client backfill without breaking an offline device that answered a dose
  -- before midnight and only reconnected the next day.
  v_backfill_window CONSTANT INTERVAL := INTERVAL '48 hours';
  -- Absorbs device clock skew only. A dose meaningfully in the future has not
  -- happened yet and must not be resolvable.
  v_future_grace CONSTANT INTERVAL := INTERVAL '5 minutes';
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

  -- ReBAC Authorization Check.
  -- Runs BEFORE the advisory lock and before any write, so an unauthorized caller can
  -- neither modify a row nor take a lock that would serialize against the scheduler.
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

  PERFORM pg_advisory_xact_lock(hashtextextended(p_medication_id::TEXT || '|' || p_scheduled_for::TEXT, 0));

  -- Look the row up BEFORE the guards below, because whether one exists is the actual
  -- question they care about. Under the advisory lock, so the scheduler's own insert for
  -- this dose cannot land between this SELECT and the write.
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

  -- Guards for a dose row that NO server process ever created — the only case where the
  -- client's claim that this dose exists at all is unverified. Gated on the absence of a
  -- row rather than on p_event_id: the Android alarm queue never has an id to send, but a
  -- dose the scheduler really fired is just as real as one the web looked up.
  IF v_existing_event.id IS NULL THEN
    -- The claimed time must be one the medication is actually scheduled for.
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(coalesce(v_medication.reminder_times, '[]'::jsonb)) AS t(reminder_time)
      WHERE t.reminder_time = v_scheduled_time_text
    ) THEN
      RAISE EXCEPTION 'INVALID_SCHEDULED_TIME';
    END IF;

    -- Bounded backfill. Name kept for client compatibility — see the header.
    IF p_scheduled_for < v_now - v_backfill_window
       OR p_scheduled_for > v_now + v_future_grace THEN
      RAISE EXCEPTION 'VIRTUAL_EVENT_MUST_BE_FOR_TODAY';
    END IF;
  END IF;

  v_target_status := CASE
    WHEN p_action = 'TAKEN' THEN 'TAKEN'
    ELSE 'SKIPPED'
  END;

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
