-- Notification targets (2026-08-14) — every notification knows where it goes.
--
-- THE BUG THIS FIXES. Tapping a dose notification did not reliably land on the
-- dose. `notifications` stored no medication_id and no scheduled_for, so the only
-- time it knew was `created_at` — the moment the ROW was written, not the moment
-- the dose was due. The client approximated the day from it and was wrong
-- whenever the two fell on opposite sides of midnight, whenever a queued offline
-- action synced hours later, and whenever a caregiver answered from another
-- timezone. It also could not tell WHICH dose, so it could never ring the card.
--
-- Caregiver notifications had the same shape of problem from the other end: a
-- care-circle event knew its `connection_id` all along and still navigated
-- nowhere, because nothing on the client turned that into a destination.
--
-- WHAT THIS ADDS: two nullable columns, and the dose trigger filling them. That
-- is all the server needs — the routing itself is a client concern and lives in
-- `web/src/lib/design/notification-kinds.ts`, next to the kind it already owns.
--
-- OLD ROWS KEEP THE APPROXIMATION. Both columns are NULL on everything written
-- before this migration, and the client falls back to the `created_at` guess for
-- exactly those. Backfilling was considered and rejected: the only join available
-- is (drug name in the message text) × (created_at within some window), which is
-- a guess dressed as data, and it would be indistinguishable afterwards from a
-- value the trigger really recorded. A NULL that admits it does not know is worth
-- more than a plausible wrong answer about which dose a patient took.
--
-- ON DELETE SET NULL on medication_id, matching `reminder_logs` and
-- `reminder_events` (migration_preserve_dose_history.sql): deleting a medication
-- must never erase the record that something happened. The notification keeps its
-- text and simply stops being tappable.
--
-- Idempotent; safe to re-run in the Supabase SQL Editor.
-- Companion files: db/rollbacks/rollback_notification_targets_2026_08_14.sql,
--                  db/validations/validation_notification_targets_2026_08_14.sql
-- ============================================================================


-- ============================================================================
-- 1. THE TWO COLUMNS
-- ----------------------------------------------------------------------------
-- Nullable on purpose and forever: care-circle and system notifications have no
-- dose, and every row written before today has no dose we can honestly name.
-- ============================================================================
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS medication_id BIGINT REFERENCES public.medications(id) ON DELETE SET NULL;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;

COMMENT ON COLUMN public.notifications.medication_id IS
  'Which medication this notification is about, when it is about one. NULL for care-circle and system notifications, and for every row written before 2026-08-14 — the client falls back to approximating the day from created_at for those.';

COMMENT ON COLUMN public.notifications.scheduled_for IS
  'The dose instant this notification is about (UTC), NOT when the row was written. created_at is the wrong thing to navigate by: a queued offline action can be recorded hours after the dose, and the two routinely fall on opposite sides of midnight.';

-- The bell reads the newest rows per user; the deep link then reads one row by
-- id. Neither needs a new index, and an unused index on a table this write-heavy
-- is a cost with no reader. Stated so nobody adds one reflexively.


-- ============================================================================
-- 2. THE DOSE TRIGGER, filling them
-- ----------------------------------------------------------------------------
-- CREATE OR REPLACE, never DROP+CREATE — a DROP takes the grants with it and
-- this function is dose-adjacent (see CLAUDE.md's hard rule and the lockdown
-- note in APPLIED.md).
--
-- Body is UNCHANGED except that all eleven INSERTs now carry NEW.medication_id
-- and NEW.scheduled_for. The trigger already had both in hand on every path —
-- it is on `reminder_events`, so `NEW` IS the dose. Nothing new is looked up and
-- no branch is added, which is what keeps this a low-risk edit to a function
-- that fans out to every caregiver.
--
-- Supersedes the definition in migration_carecircle_rca_fixes.sql.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_reminder_event_state_change()
RETURNS TRIGGER AS $$
DECLARE
  patient_uid UUID;
  patient_name TEXT;
  med_name TEXT;
  cg_rec RECORD;
  is_status_transition BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    is_status_transition := TRUE;
  ELSE
    is_status_transition := OLD.reminder_status IS DISTINCT FROM NEW.reminder_status;
  END IF;

  IF NOT is_status_transition THEN
    RETURN NEW;
  END IF;

  -- Get Medication Drug Name
  SELECT drug_name INTO med_name FROM public.medications WHERE id = NEW.medication_id;

  -- Resolve Patient UUID & Name
  SELECT id, full_name INTO patient_uid, patient_name
  FROM public.profiles
  WHERE telegram_chat_id = NEW.telegram_id;

  -- 2.1 Patient-Self Notifications (always delivered to patient)
  IF patient_uid IS NOT NULL THEN
    IF NEW.reminder_status = 'TAKEN' THEN
      IF NEW.resolved_by = 'CAREGIVER_CONFIRMED' THEN
        INSERT INTO public.notifications (user_id, title, message, type, medication_id, scheduled_for)
        VALUES (
          patient_uid, 
          'Medication Marked Taken', 
          'Your caregiver marked ' || COALESCE(med_name, 'your medication') || ' as taken.', 
          'TAKEN', NEW.medication_id, NEW.scheduled_for
        );
      ELSE
        INSERT INTO public.notifications (user_id, title, message, type, medication_id, scheduled_for)
        VALUES (
          patient_uid, 
          'Medication Taken', 
          'You successfully took ' || COALESCE(med_name, 'your medication') || '.', 
          'TAKEN', NEW.medication_id, NEW.scheduled_for
        );
      END IF;

    ELSIF NEW.reminder_status = 'SKIPPED' THEN
      IF NEW.resolved_by = 'CAREGIVER_CONFIRMED' THEN
        INSERT INTO public.notifications (user_id, title, message, type, medication_id, scheduled_for)
        VALUES (
          patient_uid, 
          'Medication Marked Skipped', 
          'Your caregiver marked ' || COALESCE(med_name, 'your medication') || ' as skipped.', 
          'SKIPPED', NEW.medication_id, NEW.scheduled_for
        );
      ELSE
        INSERT INTO public.notifications (user_id, title, message, type, medication_id, scheduled_for)
        VALUES (
          patient_uid, 
          'Medication Skipped', 
          'You skipped ' || COALESCE(med_name, 'your medication') || '.', 
          'SKIPPED', NEW.medication_id, NEW.scheduled_for
        );
      END IF;

    ELSIF NEW.reminder_status = 'UNCONFIRMED' THEN
      INSERT INTO public.notifications (user_id, title, message, type, medication_id, scheduled_for)
      VALUES (
        patient_uid, 
        'Medication Review Required', 
        'Help Us Complete Your Medication History: You have a pending review dose of ' || COALESCE(med_name, 'your medication') || ' from earlier today.', 
        'UNCONFIRMED', NEW.medication_id, NEW.scheduled_for
      );
    END IF;
  END IF;

  -- 2.2 Multi-Caregiver Fan-Out (using caregiver_connections)
  IF patient_uid IS NOT NULL THEN
    FOR cg_rec IN (
      SELECT 
        cc.caregiver_profile_id,
        cc.can_view_medications,
        cc.can_receive_escalations
      FROM public.caregiver_connections cc
      WHERE cc.patient_profile_id = patient_uid
        AND cc.is_active = true
        AND cc.connection_status = 'ACCEPTED'
    ) LOOP

      -- Handle TAKEN for Caregiver
      IF NEW.reminder_status = 'TAKEN' AND cg_rec.can_view_medications = true THEN
        IF NEW.resolved_by = 'CAREGIVER_CONFIRMED' THEN
          INSERT INTO public.notifications (user_id, title, message, type, medication_id, scheduled_for)
          VALUES (
            cg_rec.caregiver_profile_id, 
            'Medication Marked Taken', 
            CASE WHEN auth.uid() = cg_rec.caregiver_profile_id THEN 
              'You marked ' || COALESCE(patient_name, 'your patient') || '''s medication ' || COALESCE(med_name, 'medication') || ' as taken.'
            ELSE 
              'A caregiver marked ' || COALESCE(patient_name, 'your patient') || '''s medication ' || COALESCE(med_name, 'medication') || ' as taken.'
            END, 
            'TAKEN', NEW.medication_id, NEW.scheduled_for
          );
        ELSE
          INSERT INTO public.notifications (user_id, title, message, type, medication_id, scheduled_for)
          VALUES (
            cg_rec.caregiver_profile_id, 
            'Medication Taken', 
            COALESCE(patient_name, 'Patient') || ' took their medication ' || COALESCE(med_name, 'medication') || '.', 
            'TAKEN', NEW.medication_id, NEW.scheduled_for
          );
        END IF;

      -- Handle SKIPPED for Caregiver
      ELSIF NEW.reminder_status = 'SKIPPED' AND cg_rec.can_view_medications = true THEN
        IF NEW.resolved_by = 'CAREGIVER_CONFIRMED' THEN
          INSERT INTO public.notifications (user_id, title, message, type, medication_id, scheduled_for)
          VALUES (
            cg_rec.caregiver_profile_id, 
            'Medication Marked Skipped', 
            CASE WHEN auth.uid() = cg_rec.caregiver_profile_id THEN 
              'You marked ' || COALESCE(patient_name, 'your patient') || '''s medication ' || COALESCE(med_name, 'medication') || ' as skipped.'
            ELSE 
              'A caregiver marked ' || COALESCE(patient_name, 'your patient') || '''s medication ' || COALESCE(med_name, 'medication') || ' as skipped.'
            END, 
            'SKIPPED', NEW.medication_id, NEW.scheduled_for
          );
        ELSE
          INSERT INTO public.notifications (user_id, title, message, type, medication_id, scheduled_for)
          VALUES (
            cg_rec.caregiver_profile_id, 
            'Medication Skipped', 
            COALESCE(patient_name, 'Patient') || ' skipped their medication ' || COALESCE(med_name, 'medication') || '.', 
            'SKIPPED', NEW.medication_id, NEW.scheduled_for
          );
        END IF;

      -- Handle ESCALATED for Caregiver
      ELSIF NEW.reminder_status = 'ESCALATED' AND cg_rec.can_receive_escalations = true THEN
        -- Deduplicate within 2 minutes
        IF NOT EXISTS (
          SELECT 1 FROM public.notifications 
          WHERE user_id = cg_rec.caregiver_profile_id 
            AND type = 'ESCALATED' 
            AND message LIKE '%' || COALESCE(med_name, '') || '%'
            AND created_at > now() - interval '2 minutes'
        ) THEN
          INSERT INTO public.notifications (user_id, title, message, type, medication_id, scheduled_for)
          VALUES (
            cg_rec.caregiver_profile_id, 
            '🚨 Medication Escalation Alert', 
            'Alert: A critical medication for ' || COALESCE(patient_name, 'your patient') || ' (' || COALESCE(med_name, 'medication') || ') has not yet been confirmed.', 
            'ESCALATED', NEW.medication_id, NEW.scheduled_for
          );
        END IF;

      -- Handle UNCONFIRMED for Caregiver
      ELSIF NEW.reminder_status = 'UNCONFIRMED' AND cg_rec.can_receive_escalations = true THEN
        INSERT INTO public.notifications (user_id, title, message, type, medication_id, scheduled_for)
        VALUES (
          cg_rec.caregiver_profile_id, 
          'Medication Dose Unconfirmed', 
          'Dose Unconfirmed: ' || COALESCE(patient_name, 'Patient') || ' did not confirm taking their medication ' || COALESCE(med_name, 'medication') || ' today.', 
          'UNCONFIRMED', NEW.medication_id, NEW.scheduled_for
        );
      END IF;

    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 3. NOTE ON THE OTHER PRODUCERS
-- ----------------------------------------------------------------------------
-- LOW_STOCK rows are written by the Render worker (src/scheduler.js), not by a
-- trigger, and that insert now sets medication_id too — it has `med.id` in hand
-- already. It deliberately does NOT set scheduled_for: a stock warning is about
-- a medication, not about one dose of it, and inventing a dose instant would
-- send the tap to a dose the notification was never about.
--
-- CARE_CIRCLE_* rows already carry `connection_id` and always have. They need no
-- schema change at all — only a client that reads it, which is the other half of
-- this change.
--
-- MISSED rows are legacy: the current trigger emits ESCALATED, and the MISSED
-- text lives only in superseded definitions (setup_db.sql,
-- migration_caregiver_accept.sql). Existing MISSED rows stay on the fallback.
-- ============================================================================
