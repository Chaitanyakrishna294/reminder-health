-- Re-MIND-eЯ: snooze_reminder_event — fix "column reference snooze_count is ambiguous" (42702)
-- Migration: migration_snooze_ambiguous_column_2026_08_11.sql
-- HOTFIX for migration_snooze_reminder_event_2026_08_11.sql (APPLIED.md #65).
--
-- THE BUG, caught on the first real device snooze (2026-08-11, vivo I2202):
--
--   snooze_reminder_event HTTP 400: {"code":"42702",
--    "message":"column reference \"snooze_count\" is ambiguous",
--    "details":"It could refer to either a PL/pgSQL variable or a table column."}
--
-- `RETURNS TABLE(..., snooze_count integer, ...)` declares snooze_count as an OUT variable, so
-- inside the function body that name is in scope as BOTH a PL/pgSQL variable and a column of
-- reminder_events. In
--
--   SET snooze_count = COALESCE(snooze_count, 0) + 1
--
-- the left side is unambiguous (SET targets are always columns) but the right side is not, and
-- PL/pgSQL refuses to guess. The sibling assignments happened to be safe by luck: reminder_status
-- and retry_reminder_at are also OUT names, but neither is READ on a right-hand side, and
-- resolution_channel is read but is not an OUT name.
--
-- WHY IT SURVIVED REVIEW AND VALIDATION: plpgsql function bodies are only parsed at first
-- EXECUTION, so CREATE OR REPLACE accepted it and every validation check — which inspect the
-- catalog, not behaviour — reported DONE. The first thing to ever run it was a real snooze on a
-- real dose. Worth remembering when validating a plpgsql migration: "applied and validated" does
-- not mean "executed once".
--
-- IMPACT WHILE BROKEN: no data was lost. The device's local re-registration half of the snooze
-- worked correctly (the alarm re-fires, carrying the ORIGINAL dose instant), and the failed
-- server half left the action queued and retryable — it retried twice, stayed queued, and will
-- sync on the next flush once this is applied. What WAS wrong for that window: the server still
-- considered the dose unanswered, which is precisely the false-caregiver-escalation risk this RPC
-- exists to prevent.
--
-- THE FIX: qualify the read as reminder_events.snooze_count. Deliberately NOT v_event.snooze_count
-- — that is a value read earlier in the transaction, whereas the qualified column is the live row
-- being updated. The Telegram bot writes these rows with service_role and does not take this
-- function's advisory lock, so reading the column at UPDATE time is the honest choice.
--
-- Also added while here: FOR UPDATE on the row lookups, matching resolve_reminder_event. The
-- advisory lock already serialises callers of THIS function against each other; the row lock is
-- what serialises against the bot's direct updates. Lock ordering (advisory, then row) is the same
-- as resolve_reminder_event's, so the two cannot deadlock against each other.
--
-- Apply in the Supabase SQL editor, then run
-- db/validations/validation_snooze_ambiguous_column_2026_08_11.sql — check 1 actually CALLS the
-- function in a rolled-back transaction, which is the check that would have caught this.

BEGIN;

-- CREATE OR REPLACE, never DROP + CREATE — a DROP resets the ACL to PUBLIC EXECUTE. The GRANT
-- block from the original migration is re-stated at the bottom anyway, but the rule stands.
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
    AND scheduled_for = p_scheduled_for
  FOR UPDATE;

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
      AND scheduled_for = p_scheduled_for
    FOR UPDATE;
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
      -- QUALIFIED: bare `snooze_count` here is ambiguous with the RETURNS TABLE
      -- OUT variable of the same name and raises 42702 at runtime. This is the
      -- whole point of this migration — do not "simplify" it back.
      snooze_count = COALESCE(public.reminder_events.snooze_count, 0) + 1,
      resolution_channel = COALESCE(p_resolution_channel, public.reminder_events.resolution_channel)
  WHERE id = v_event.id
  RETURNING * INTO v_event;

  RETURN QUERY SELECT
    v_event.id, v_event.reminder_status, v_event.retry_reminder_at,
    v_event.snooze_count, FALSE, FALSE;
END;
$function$;

-- Re-stated rather than assumed: CREATE OR REPLACE preserves grants, but this function's whole
-- security posture is these three lines and they are cheap to repeat.
REVOKE ALL ON FUNCTION public.snooze_reminder_event(bigint, timestamptz, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.snooze_reminder_event(bigint, timestamptz, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.snooze_reminder_event(bigint, timestamptz, integer, text) TO authenticated;

COMMIT;
