-- Snooze from a client (the Android full-screen alarm) had nowhere to go.
--
-- resolve_reminder_event only branches on 'TAKEN' vs everything-else-is-'SKIPPED';
-- there is no SNOOZED outcome in it. The ONLY existing snooze implementation is the
-- Telegram bot (src/commands.js), which UPDATEs reminder_events directly using the
-- service_role key. A web/native client cannot do that: reminder_events is SELECT-only
-- under RLS and every client write goes through a SECURITY DEFINER RPC.
--
-- Why this matters beyond parity: without it a device snooze would have to be
-- device-local only, so the server would still consider the dose unanswered and
-- escalate to the care circle — a FALSE caregiver alert for a patient who did respond.
-- That is unacceptable for a care-circle product, so the snooze has to reach the server.
--
-- Mirrors the bot exactly (src/commands.js:1557-1594, src/constants.js):
--   SNOOZE_MINUTES = 10, MAX_SNOOZES = 3, sets reminder_status='SNOOZED',
--   retry_reminder_at = now + minutes, increments snooze_count.
-- The scheduler's existing snooze re-fire branch then picks it up and stamps
-- last_prompted_at at RE-FIRE (not here) — which is what keeps the escalation ladder
-- anchored on the last real prompt.
--
-- Apply in the Supabase SQL editor. Safe on live data: it only ever touches the single
-- reminder_events row for (p_medication_id, p_scheduled_for).

BEGIN;

-- CREATE OR REPLACE, never DROP + CREATE. A DROP resets the function's ACL back to the
-- default PUBLIC EXECUTE, which has already silently re-exposed scheduler-adjacent
-- functions in this repo's history (see APPLIED.md's lockdown note). REPLACE preserves
-- the grants at the bottom of this file.
CREATE OR REPLACE FUNCTION public.snooze_reminder_event(
  p_medication_id bigint,
  p_scheduled_for timestamp with time zone,
  p_snooze_minutes integer DEFAULT 10,
  p_resolution_channel text DEFAULT NULL::text
)
RETURNS TABLE(
  event_id bigint,
  reminder_status text,
  retry_reminder_at timestamp with time zone,
  snooze_count integer,
  capped boolean,
  already_resolved boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_profile_id UUID;
  v_profile_telegram_id TEXT;
  v_medication public.medications%ROWTYPE;
  v_event public.reminder_events%ROWTYPE;
  v_now TIMESTAMPTZ := now();
  v_minutes INTEGER;
  v_max_snoozes CONSTANT INTEGER := 3;  -- src/constants.js MAX_SNOOZES
BEGIN
  IF p_medication_id IS NULL OR p_scheduled_for IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENTS';
  END IF;

  -- Clamp rather than trust the caller: this is a client-callable RPC, and an
  -- unbounded value would let a caller park a dose arbitrarily far in the future
  -- and dodge escalation entirely.
  v_minutes := LEAST(GREATEST(COALESCE(p_snooze_minutes, 10), 1), 60);

  SELECT id, telegram_chat_id
  INTO v_profile_id, v_profile_telegram_id
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_profile_id IS NULL OR v_profile_telegram_id IS NULL THEN
    RAISE EXCEPTION 'PROFILE_NOT_LINKED';
  END IF;

  SELECT * INTO v_medication
  FROM public.medications
  WHERE id = p_medication_id;

  IF v_medication.id IS NULL THEN
    RAISE EXCEPTION 'MEDICATION_NOT_FOUND';
  END IF;

  -- Patient-only, deliberately narrower than resolve_reminder_event's ReBAC check.
  -- Snoozing is "not right now, ask me again" — a statement only the person taking
  -- the medication can make. A caregiver deferring someone else's dose would suppress
  -- the very escalation they are the audience for.
  IF v_medication.telegram_id IS DISTINCT FROM v_profile_telegram_id THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- Serialize against the scheduler's own re-fire on this exact dose.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_medication_id::TEXT || '|' || p_scheduled_for::TEXT, 0)
  );

  SELECT * INTO v_event
  FROM public.reminder_events
  WHERE medication_id = p_medication_id
    AND scheduled_for = p_scheduled_for;

  -- The device alarm can fire before the server has an event row for this dose
  -- (e.g. the phone was offline when the server tick ran, or the device is simply
  -- ahead). Insert it, same as resolve_reminder_event does for a virtual dose, so
  -- the snooze is never silently dropped.
  IF v_event.id IS NULL THEN
    INSERT INTO public.reminder_events (
      medication_id, telegram_id, scheduled_for, reminder_status,
      retry_count, snooze_count, retry_reminder_at
    )
    VALUES (
      p_medication_id, v_medication.telegram_id, p_scheduled_for, 'SENT',
      0, 0, NULL
    )
    ON CONFLICT (medication_id, scheduled_for) DO NOTHING;

    SELECT * INTO v_event
    FROM public.reminder_events
    WHERE medication_id = p_medication_id
      AND scheduled_for = p_scheduled_for;
  END IF;

  -- Already answered: report it, change nothing. A late snooze must never reopen a
  -- dose the patient already took or skipped.
  IF v_event.reminder_status IN ('TAKEN', 'SKIPPED') THEN
    RETURN QUERY SELECT
      v_event.id, v_event.reminder_status, v_event.retry_reminder_at,
      v_event.snooze_count, FALSE, TRUE;
    RETURN;
  END IF;

  -- Snooze budget exhausted: leave the row alone so the escalation ladder keeps
  -- running. Endless snoozing is how a missed dose hides from the care circle.
  IF COALESCE(v_event.snooze_count, 0) >= v_max_snoozes THEN
    RETURN QUERY SELECT
      v_event.id, v_event.reminder_status, v_event.retry_reminder_at,
      v_event.snooze_count, TRUE, FALSE;
    RETURN;
  END IF;

  UPDATE public.reminder_events
  SET reminder_status = 'SNOOZED',
      retry_reminder_at = v_now + make_interval(mins => v_minutes),
      snooze_count = COALESCE(snooze_count, 0) + 1,
      resolution_channel = COALESCE(p_resolution_channel, resolution_channel)
  WHERE id = v_event.id
  RETURNING * INTO v_event;

  RETURN QUERY SELECT
    v_event.id, v_event.reminder_status, v_event.retry_reminder_at,
    v_event.snooze_count, FALSE, FALSE;
END;
$function$;

-- Client-callable, authenticated only. anon and PUBLIC explicitly revoked — the
-- 2026-07 hardening pass showed that revoking anon alone is a no-op when the
-- privilege is held via PUBLIC.
REVOKE ALL ON FUNCTION public.snooze_reminder_event(bigint, timestamptz, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.snooze_reminder_event(bigint, timestamptz, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.snooze_reminder_event(bigint, timestamptz, integer, text) TO authenticated;

COMMIT;
