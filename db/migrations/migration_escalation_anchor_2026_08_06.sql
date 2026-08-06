-- Escalation-anchor fix (2026-08-06) — measure the caregiver-escalation ladder
-- from when the PATIENT WAS LAST ACTUALLY PROMPTED, not from the dose's
-- original due time. Patient-safety critical: this is the state machine that
-- decides when a caregiver is alarmed about a missed dose.
--
-- Defect (confirmed by three adversarial reviews):
--   scan_and_escalate_overdue_reminders measured every threshold from
--   reminder_events.scheduled_for. Two failure modes:
--   1. LATE DELIVERY — worker down ~25 min (Render restart/deploy): a critical
--      dose due 09:00 is first delivered 09:25. The same tick's scan sees
--      now >= scheduled_for + 10m and fires GENTLE_REMINDER seconds after the
--      patient's FIRST chance to respond; the next tick fires ESCALATED, so the
--      caregiver is alarmed ~60s after the first prompt; at +60m the dose
--      silently becomes PENDING_REVIEW.
--   2. SNOOZE — SNOOZE_MINUTES (10) equals the critical gentle threshold, so a
--      snooze re-fire (row set back to SENT at scheduled_for + >=10m) is
--      immediately followed by a redundant GENTLE_REMINDER on the very next
--      scan. The patient who explicitly asked for 10 quiet minutes gets two
--      messages a tick apart, and their engagement never paused the countdown.
--
-- Fix: new column reminder_events.last_prompted_at, stamped by BOTH senders
-- (src/scheduler.js and web/src/app/api/cron/tick/route.ts) ONLY at the snooze
-- re-fire (SNOOZED -> SENT), becomes the ladder anchor override:
--   v_anchor := LEAST(
--                 GREATEST(re.scheduled_for,
--                          COALESCE(re.last_prompted_at, re.created_at, re.scheduled_for)),
--                 COALESCE(re.created_at, re.scheduled_for) + interval '30 minutes')
-- The initial send deliberately does NOT stamp the column: created_at DEFAULT
-- now() is written by the DB on that same INSERT, so the COALESCE yields an
-- identical anchor — and the hottest write path stays decoupled from this
-- hand-applied migration (an INSERT naming a not-yet-added column would fail
-- every send). created_at cannot serve for the snooze re-fire: that UPDATEs
-- the same row (id preserved), so created_at never moves.
--
-- Deploy ordering (either order is now SAFE; apply-first is still recommended):
--   * Migration applied, old code still deployed: the insert path is untouched
--     (nothing names the column), and the LATE-DELIVERY fix goes live
--     immediately via the created_at fallback. Only the snooze re-fire
--     improvement (redundant-gentle fix) waits for the code deploy; until then
--     snoozed doses anchor on created_at — never worse than today.
--   * New code deployed, migration not applied: inserts are unaffected (they
--     never name the column); the snooze SNOOZED->SENT flip is a separate
--     statement and still succeeds; only the best-effort anchor stamp fails
--     (caught + logged), and the worker's boot guard logs FATAL-CONFIG naming
--     this file. Degrades gracefully — no reminder or escalation is blocked.
--
-- NOT a backstop: close_daily_medications sweeps ONLY rows in PENDING_REVIEW
-- or ESCALATED (at max(scheduled_for) + 2h, see
-- migration_arch_hardening_2026_06.sql). Because this change deliberately
-- delays entry into those statuses, doses spend LONGER in un-swept statuses
-- (SENT/GENTLE_REMINDER) — the day-end sweep does not catch a dose the ladder
-- never escalated. The 30-minute anchor ceiling below bounds that delay.
--
-- Idempotent; safe to re-run in the Supabase SQL Editor.
-- Companion files: db/rollbacks/rollback_escalation_anchor_2026_08_06.sql,
--                  db/validations/validation_escalation_anchor_2026_08_06.sql

BEGIN;

-- ============================================================================
-- 1. ANCHOR COLUMN (deliberately NO backfill — see below)
-- ============================================================================
ALTER TABLE public.reminder_events ADD COLUMN IF NOT EXISTS last_prompted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.reminder_events.last_prompted_at IS
  'Set ONLY by a snooze re-fire (SNOOZED->SENT): most recent time the patient was re-prompted after asking for quiet time. NULL is the normal state for doses never snooze-re-fired — the escalation ladder in scan_and_escalate_overdue_reminders then anchors on created_at (= initial-send time for this table). Deliberately NOT re-armed by GENTLE_REMINDER re-sends: those ARE the ladder, and re-arming the anchor on each one would make ESCALATED/PENDING_REVIEW unreachable. The ladder clamps the anchor to created_at + 30 minutes.';

-- NO BACKFILL — deliberately. The anchor COALESCEs to created_at, which for
-- this table IS the initial-send time (rows are inserted at the moment of
-- sending), so existing rows already evaluate to exactly the anchor a backfill
-- would have written — a full-table UPDATE would change nothing. It would also
-- run inside this same transaction as the ALTER above, holding its ACCESS
-- EXCLUSIVE lock on reminder_events for the entire table rewrite. NULL is the
-- expected steady state for every row that never had a snooze re-fire.

-- ============================================================================
-- 2. REDEFINE THE SCANNER WHOLESALE
-- ----------------------------------------------------------------------------
-- Body copied from migration_5.7b_escalation_outcomes_logic.sql (the current
-- definition per APPLIED.md) with ONLY the threshold anchor changed:
-- every "v_rec.r_scheduled_for + interval ..." threshold comparison becomes
-- "v_anchor + interval ...", where v_anchor is the CLAMPED last-prompt anchor
-- computed at the top of the loop (last_prompted_at/created_at, capped at
-- created_at + 30 minutes). The returned scheduled_for column, the status
-- filter, the cooldown logic, the RETURN NEXT payloads, and the per-tier
-- interval VALUES (critical 10/20/60, important 20/45/90, normal 60/120) are
-- byte-identical to 5.7b — only what the intervals are measured FROM changes.
--
-- CREATE OR REPLACE, no DROP: the return type is unchanged, and REPLACE
-- preserves the existing ACL from migration_security_lockdown_2026_07_29.sql
-- (a DROP + CREATE would reset it to PUBLIC EXECUTE — see the lockdown note
-- in APPLIED.md). The ACL is still re-asserted in section 3 below.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.scan_and_escalate_overdue_reminders()
RETURNS TABLE (
  event_id BIGINT,
  medication_id BIGINT,
  old_status TEXT,
  new_status TEXT,
  telegram_id TEXT,
  drug_name TEXT,
  priority_level TEXT,
  scheduled_for TIMESTAMPTZ,
  dosage TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_rec RECORD;
  v_anchor TIMESTAMPTZ;
  v_cooldown_until TIMESTAMPTZ;
  v_can_escalate BOOLEAN;
BEGIN
  -- Loop through all active reminder events that are not in a final state
  FOR v_rec IN
    SELECT
      re.id AS r_event_id,
      re.medication_id AS r_medication_id,
      re.reminder_status AS r_status,
      re.scheduled_for AS r_scheduled_for,
      re.last_prompted_at AS r_last_prompted_at,
      re.created_at AS r_created_at,
      re.telegram_id AS r_telegram_id,
      m.drug_name AS m_drug_name,
      m.priority_level AS m_priority,
      m.dosage AS m_dosage,
      p.id AS patient_profile_id
    FROM public.reminder_events re
    JOIN public.medications m ON m.id = re.medication_id
    LEFT JOIN public.profiles p ON p.telegram_chat_id = re.telegram_id
    WHERE re.reminder_status IN ('SENT', 'DISPLAYED', 'OPENED', 'GENTLE_REMINDER', 'ESCALATED')
  LOOP
    -- ESCALATION ANCHOR — WHY: thresholds must measure from the patient's real
    -- last prompt (initial send = created_at, snooze re-fire =
    -- last_prompted_at), not the original due time, or a late-delivered dose
    -- escalates before the patient had any chance to respond.
    -- GREATEST(scheduled_for, ...) keeps on-time doses behaving exactly as
    -- before and guards against a prompt timestamp that somehow predates the
    -- due time. COALESCE covers rows with no snooze re-fire (created_at =
    -- insert/send time for this table; scheduled_for is the last resort).
    -- GENTLE_REMINDER re-sends deliberately do NOT update last_prompted_at —
    -- they are the ladder itself; if each rung re-armed the anchor, escalation
    -- would never fire. Only a snooze re-fire moves it.
    --
    -- CLAMP — CLINICAL REASONING: every snooze re-fire re-arms the FULL
    -- ladder, so an unbounded anchor lets repeated snoozes cost
    -- SNOOZE_MINUTES plus the whole re-armed threshold per cycle (verified
    -- trace: critical dose due 09:00, MAX_SNOOZES=3 -> caregiver alerted
    -- 10:47, +107 min). The LEAST(...) ceiling caps how far engagement can
    -- move the anchor: at most 30 minutes past the FIRST prompt (created_at;
    -- scheduled_for as last resort). Both original fixes survive intact:
    --   * 25-min outage: created_at 09:25, ceiling 09:55 -> anchor stays 09:25.
    --   * Snooze: the first snooze always keeps its full quiet period; e.g.
    --     critical back-to-back snoozes x3 -> anchor capped at first_prompt
    --     +30m, caregiver alerted ~first_prompt+50m instead of +107m.
    -- Worst case per tier, measured from the FIRST prompt, maximal
    -- back-to-back snoozing (anchor ceiling +30m; add <=1 min scan-tick lag):
    --   critical:  GENTLE <= +40m, ESCALATED (caregiver) <= +50m, REVIEW <= +90m
    --   important: GENTLE <= +50m, ESCALATED (caregiver) <= +75m, REVIEW <= +120m
    --   normal:    GENTLE <= +90m, REVIEW <= +150m (tier has no caregiver rung)
    -- Adversarial timing (snoozing seconds before each rung) can stretch these
    -- only by SNOOZE_MINUTES + ~2 ticks per snooze — time spent SNOOZED is
    -- excluded from this scan by design — e.g. critical caregiver alert
    -- <= ~+72m absolute worst; still bounded, vs re-armable +107m pre-clamp.
    v_anchor := LEAST(
                  GREATEST(v_rec.r_scheduled_for,
                           COALESCE(v_rec.r_last_prompted_at, v_rec.r_created_at, v_rec.r_scheduled_for)),
                  COALESCE(v_rec.r_created_at, v_rec.r_scheduled_for) + interval '30 minutes');

    -- 1. CRITICAL PRIORITY:
    -- Gentle Reminder at +10m, Escalation at +20m, Pending Review at +60m
    IF v_rec.m_priority = 'critical' THEN
      IF v_rec.r_status IN ('SENT', 'DISPLAYED', 'OPENED') AND v_now >= v_anchor + interval '10 minutes' THEN
        UPDATE public.reminder_events SET reminder_status = 'GENTLE_REMINDER' WHERE id = v_rec.r_event_id;
        event_id := v_rec.r_event_id; medication_id := v_rec.r_medication_id; old_status := v_rec.r_status; new_status := 'GENTLE_REMINDER';
        telegram_id := v_rec.r_telegram_id; drug_name := v_rec.m_drug_name; priority_level := v_rec.m_priority;
        scheduled_for := v_rec.r_scheduled_for; dosage := v_rec.m_dosage;
        RETURN NEXT;
      ELSIF v_rec.r_status = 'GENTLE_REMINDER' AND v_now >= v_anchor + interval '20 minutes' THEN
        -- Check cooldown for the patient
        v_can_escalate := FALSE;
        IF v_rec.patient_profile_id IS NOT NULL THEN
          SELECT cooldown_until INTO v_cooldown_until
          FROM public.patient_escalation_state
          WHERE patient_profile_id = v_rec.patient_profile_id;

          IF v_cooldown_until IS NULL OR v_now >= v_cooldown_until THEN
            v_can_escalate := TRUE;
          END IF;
        ELSE
          -- If patient profile doesn't exist, allow escalation without cooldown throttling
          v_can_escalate := TRUE;
        END IF;

        IF v_can_escalate THEN
          -- Transition to ESCALATED and set cooldown
          UPDATE public.reminder_events SET reminder_status = 'ESCALATED', escalated_at = v_now WHERE id = v_rec.r_event_id;

          IF v_rec.patient_profile_id IS NOT NULL THEN
            INSERT INTO public.patient_escalation_state (patient_profile_id, last_escalated_at, cooldown_until)
            VALUES (v_rec.patient_profile_id, v_now, v_now + interval '30 minutes')
            ON CONFLICT (patient_profile_id) DO UPDATE SET
              last_escalated_at = EXCLUDED.last_escalated_at,
              cooldown_until = EXCLUDED.cooldown_until;
          END IF;

          event_id := v_rec.r_event_id; medication_id := v_rec.r_medication_id; old_status := v_rec.r_status; new_status := 'ESCALATED';
          telegram_id := v_rec.r_telegram_id; drug_name := v_rec.m_drug_name; priority_level := v_rec.m_priority;
          scheduled_for := v_rec.r_scheduled_for; dosage := v_rec.m_dosage;
          RETURN NEXT;
        END IF;
      ELSIF v_rec.r_status = 'ESCALATED' AND v_now >= v_anchor + interval '60 minutes' THEN
        UPDATE public.reminder_events SET reminder_status = 'PENDING_REVIEW' WHERE id = v_rec.r_event_id;
        event_id := v_rec.r_event_id; medication_id := v_rec.r_medication_id; old_status := v_rec.r_status; new_status := 'PENDING_REVIEW';
        telegram_id := v_rec.r_telegram_id; drug_name := v_rec.m_drug_name; priority_level := v_rec.m_priority;
        scheduled_for := v_rec.r_scheduled_for; dosage := v_rec.m_dosage;
        RETURN NEXT;
      END IF;

    -- 2. IMPORTANT PRIORITY:
    -- Gentle Reminder at +20m, Escalation at +45m, Pending Review at +90m
    ELSIF v_rec.m_priority = 'important' THEN
      IF v_rec.r_status IN ('SENT', 'DISPLAYED', 'OPENED') AND v_now >= v_anchor + interval '20 minutes' THEN
        UPDATE public.reminder_events SET reminder_status = 'GENTLE_REMINDER' WHERE id = v_rec.r_event_id;
        event_id := v_rec.r_event_id; medication_id := v_rec.r_medication_id; old_status := v_rec.r_status; new_status := 'GENTLE_REMINDER';
        telegram_id := v_rec.r_telegram_id; drug_name := v_rec.m_drug_name; priority_level := v_rec.m_priority;
        scheduled_for := v_rec.r_scheduled_for; dosage := v_rec.m_dosage;
        RETURN NEXT;
      ELSIF v_rec.r_status = 'GENTLE_REMINDER' AND v_now >= v_anchor + interval '45 minutes' THEN
        -- Check cooldown for the patient
        v_can_escalate := FALSE;
        IF v_rec.patient_profile_id IS NOT NULL THEN
          SELECT cooldown_until INTO v_cooldown_until
          FROM public.patient_escalation_state
          WHERE patient_profile_id = v_rec.patient_profile_id;

          IF v_cooldown_until IS NULL OR v_now >= v_cooldown_until THEN
            v_can_escalate := TRUE;
          END IF;
        ELSE
          v_can_escalate := TRUE;
        END IF;

        IF v_can_escalate THEN
          UPDATE public.reminder_events SET reminder_status = 'ESCALATED', escalated_at = v_now WHERE id = v_rec.r_event_id;

          IF v_rec.patient_profile_id IS NOT NULL THEN
            INSERT INTO public.patient_escalation_state (patient_profile_id, last_escalated_at, cooldown_until)
            VALUES (v_rec.patient_profile_id, v_now, v_now + interval '30 minutes')
            ON CONFLICT (patient_profile_id) DO UPDATE SET
              last_escalated_at = EXCLUDED.last_escalated_at,
              cooldown_until = EXCLUDED.cooldown_until;
          END IF;

          event_id := v_rec.r_event_id; medication_id := v_rec.r_medication_id; old_status := v_rec.r_status; new_status := 'ESCALATED';
          telegram_id := v_rec.r_telegram_id; drug_name := v_rec.m_drug_name; priority_level := v_rec.m_priority;
          scheduled_for := v_rec.r_scheduled_for; dosage := v_rec.m_dosage;
          RETURN NEXT;
        END IF;
      ELSIF v_rec.r_status = 'ESCALATED' AND v_now >= v_anchor + interval '90 minutes' THEN
        UPDATE public.reminder_events SET reminder_status = 'PENDING_REVIEW' WHERE id = v_rec.r_event_id;
        event_id := v_rec.r_event_id; medication_id := v_rec.r_medication_id; old_status := v_rec.r_status; new_status := 'PENDING_REVIEW';
        telegram_id := v_rec.r_telegram_id; drug_name := v_rec.m_drug_name; priority_level := v_rec.m_priority;
        scheduled_for := v_rec.r_scheduled_for; dosage := v_rec.m_dosage;
        RETURN NEXT;
      END IF;

    -- 3. NORMAL PRIORITY:
    -- Gentle Reminder at +60m, No Escalation, Pending Review at +120m (Bypasses Escalation)
    ELSE
      IF v_rec.r_status IN ('SENT', 'DISPLAYED', 'OPENED') AND v_now >= v_anchor + interval '60 minutes' THEN
        UPDATE public.reminder_events SET reminder_status = 'GENTLE_REMINDER' WHERE id = v_rec.r_event_id;
        event_id := v_rec.r_event_id; medication_id := v_rec.r_medication_id; old_status := v_rec.r_status; new_status := 'GENTLE_REMINDER';
        telegram_id := v_rec.r_telegram_id; drug_name := v_rec.m_drug_name; priority_level := v_rec.m_priority;
        scheduled_for := v_rec.r_scheduled_for; dosage := v_rec.m_dosage;
        RETURN NEXT;
      ELSIF v_rec.r_status = 'GENTLE_REMINDER' AND v_now >= v_anchor + interval '120 minutes' THEN
        UPDATE public.reminder_events SET reminder_status = 'PENDING_REVIEW' WHERE id = v_rec.r_event_id;
        event_id := v_rec.r_event_id; medication_id := v_rec.r_medication_id; old_status := v_rec.r_status; new_status := 'PENDING_REVIEW';
        telegram_id := v_rec.r_telegram_id; drug_name := v_rec.m_drug_name; priority_level := v_rec.m_priority;
        scheduled_for := v_rec.r_scheduled_for; dosage := v_rec.m_dosage;
        RETURN NEXT;
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- ============================================================================
-- 3. RE-ASSERT THE SECURITY LOCKDOWN ACL
-- ----------------------------------------------------------------------------
-- CREATE OR REPLACE above preserves the existing ACL, but this function both
-- mutates dose state and returns cross-patient PHI — belt and braces, and it
-- keeps this file safe if anyone later converts section 2 to DROP + CREATE
-- (which WOULD reset the ACL to PUBLIC EXECUTE).
-- Mirrors migration_security_lockdown_2026_07_29.sql section A (applied
-- 2026-08-06) — do not undo it.
-- ============================================================================
REVOKE ALL ON FUNCTION public.scan_and_escalate_overdue_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scan_and_escalate_overdue_reminders() TO service_role;

-- Tell PostgREST to reload its schema cache immediately so API clients see the
-- new column without waiting for the cache to expire (otherwise writes naming
-- last_prompted_at can get PGRST204 until the reload).
NOTIFY pgrst, 'reload schema';

COMMIT;
