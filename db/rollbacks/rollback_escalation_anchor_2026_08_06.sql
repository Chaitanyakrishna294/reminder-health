-- Rollback for migration_escalation_anchor_2026_08_06.sql
-- WARNING: this restores the PRIOR, DEFECTIVE ladder timing — thresholds
-- measured from scheduled_for again, reinstating the confirmed defects:
-- late-delivered doses escalate to the caregiver before the patient had any
-- chance to respond, and a snooze re-fire is followed by a redundant
-- GENTLE_REMINDER one tick later. Apply only to un-break something.
--
-- The last_prompted_at COLUMN IS DELIBERATELY KEPT: dropping it would destroy
-- recorded prompt-time data. The deployed code never names it on INSERT (the
-- send paths are decoupled by design); only the snooze re-fire's separate
-- best-effort stamp names it, and that failure is caught and logged — but
-- dropping the column would make every snooze re-fire log an error. Unused by
-- this restored function body, the column is harmless. Keep it.

BEGIN;

-- ============================================================================
-- Restore scan_and_escalate_overdue_reminders exactly as defined in
-- migration_5.7b_escalation_outcomes_logic.sql (the pre-anchor definition).
-- CREATE OR REPLACE, no DROP: return type unchanged, so the ACL from
-- migration_security_lockdown_2026_07_29.sql is preserved (re-asserted below
-- anyway).
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
    -- 1. CRITICAL PRIORITY:
    -- Gentle Reminder at +10m, Escalation at +20m, Pending Review at +60m
    IF v_rec.m_priority = 'critical' THEN
      IF v_rec.r_status IN ('SENT', 'DISPLAYED', 'OPENED') AND v_now >= v_rec.r_scheduled_for + interval '10 minutes' THEN
        UPDATE public.reminder_events SET reminder_status = 'GENTLE_REMINDER' WHERE id = v_rec.r_event_id;
        event_id := v_rec.r_event_id; medication_id := v_rec.r_medication_id; old_status := v_rec.r_status; new_status := 'GENTLE_REMINDER';
        telegram_id := v_rec.r_telegram_id; drug_name := v_rec.m_drug_name; priority_level := v_rec.m_priority;
        scheduled_for := v_rec.r_scheduled_for; dosage := v_rec.m_dosage;
        RETURN NEXT;
      ELSIF v_rec.r_status = 'GENTLE_REMINDER' AND v_now >= v_rec.r_scheduled_for + interval '20 minutes' THEN
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
      ELSIF v_rec.r_status = 'ESCALATED' AND v_now >= v_rec.r_scheduled_for + interval '60 minutes' THEN
        UPDATE public.reminder_events SET reminder_status = 'PENDING_REVIEW' WHERE id = v_rec.r_event_id;
        event_id := v_rec.r_event_id; medication_id := v_rec.r_medication_id; old_status := v_rec.r_status; new_status := 'PENDING_REVIEW';
        telegram_id := v_rec.r_telegram_id; drug_name := v_rec.m_drug_name; priority_level := v_rec.m_priority;
        scheduled_for := v_rec.r_scheduled_for; dosage := v_rec.m_dosage;
        RETURN NEXT;
      END IF;

    -- 2. IMPORTANT PRIORITY:
    -- Gentle Reminder at +20m, Escalation at +45m, Pending Review at +90m
    ELSIF v_rec.m_priority = 'important' THEN
      IF v_rec.r_status IN ('SENT', 'DISPLAYED', 'OPENED') AND v_now >= v_rec.r_scheduled_for + interval '20 minutes' THEN
        UPDATE public.reminder_events SET reminder_status = 'GENTLE_REMINDER' WHERE id = v_rec.r_event_id;
        event_id := v_rec.r_event_id; medication_id := v_rec.r_medication_id; old_status := v_rec.r_status; new_status := 'GENTLE_REMINDER';
        telegram_id := v_rec.r_telegram_id; drug_name := v_rec.m_drug_name; priority_level := v_rec.m_priority;
        scheduled_for := v_rec.r_scheduled_for; dosage := v_rec.m_dosage;
        RETURN NEXT;
      ELSIF v_rec.r_status = 'GENTLE_REMINDER' AND v_now >= v_rec.r_scheduled_for + interval '45 minutes' THEN
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
      ELSIF v_rec.r_status = 'ESCALATED' AND v_now >= v_rec.r_scheduled_for + interval '90 minutes' THEN
        UPDATE public.reminder_events SET reminder_status = 'PENDING_REVIEW' WHERE id = v_rec.r_event_id;
        event_id := v_rec.r_event_id; medication_id := v_rec.r_medication_id; old_status := v_rec.r_status; new_status := 'PENDING_REVIEW';
        telegram_id := v_rec.r_telegram_id; drug_name := v_rec.m_drug_name; priority_level := v_rec.m_priority;
        scheduled_for := v_rec.r_scheduled_for; dosage := v_rec.m_dosage;
        RETURN NEXT;
      END IF;

    -- 3. NORMAL PRIORITY:
    -- Gentle Reminder at +60m, No Escalation, Pending Review at +120m (Bypasses Escalation)
    ELSE
      IF v_rec.r_status IN ('SENT', 'DISPLAYED', 'OPENED') AND v_now >= v_rec.r_scheduled_for + interval '60 minutes' THEN
        UPDATE public.reminder_events SET reminder_status = 'GENTLE_REMINDER' WHERE id = v_rec.r_event_id;
        event_id := v_rec.r_event_id; medication_id := v_rec.r_medication_id; old_status := v_rec.r_status; new_status := 'GENTLE_REMINDER';
        telegram_id := v_rec.r_telegram_id; drug_name := v_rec.m_drug_name; priority_level := v_rec.m_priority;
        scheduled_for := v_rec.r_scheduled_for; dosage := v_rec.m_dosage;
        RETURN NEXT;
      ELSIF v_rec.r_status = 'GENTLE_REMINDER' AND v_now >= v_rec.r_scheduled_for + interval '120 minutes' THEN
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
-- Re-assert the security lockdown ACL (CREATE OR REPLACE preserves it; this
-- guards against a live ACL that had already drifted).
-- ============================================================================
REVOKE ALL ON FUNCTION public.scan_and_escalate_overdue_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scan_and_escalate_overdue_reminders() TO service_role;

COMMIT;
