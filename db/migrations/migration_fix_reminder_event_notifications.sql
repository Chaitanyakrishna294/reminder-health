-- Deployment 1, phase 1: make reminder event notifications safe for both INSERT and UPDATE paths.

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_reminder_event_state_change()
RETURNS TRIGGER AS $$
DECLARE
  patient_uid UUID;
  caregiver_uid UUID;
  med_name TEXT;
  patient_name TEXT;
  cg_chat_id TEXT;
  is_status_transition BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    is_status_transition := TRUE;
  ELSE
    is_status_transition := OLD.reminder_status IS DISTINCT FROM NEW.reminder_status;
  END IF;

  IF NOT is_status_transition THEN
    RETURN NEW;
  END IF;

  SELECT drug_name
  INTO med_name
  FROM public.medications
  WHERE id = NEW.medication_id;

  SELECT id, full_name
  INTO patient_uid, patient_name
  FROM public.profiles
  WHERE telegram_chat_id = NEW.telegram_id
    AND role = 'PATIENT';

  SELECT caregiver_chat_id
  INTO cg_chat_id
  FROM public.caregiver_info
  WHERE patient_telegram_id = NEW.telegram_id
    AND is_active = true
    AND connection_status = 'ACCEPTED'
  LIMIT 1;

  IF cg_chat_id IS NOT NULL THEN
    SELECT id
    INTO caregiver_uid
    FROM public.profiles
    WHERE telegram_chat_id = cg_chat_id
      AND role = 'CAREGIVER';
  END IF;

  IF NEW.reminder_status = 'TAKEN' THEN
    IF NEW.resolved_by = 'CAREGIVER' THEN
      IF patient_uid IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          patient_uid,
          'Medication Marked Taken',
          'Your caregiver marked ' || COALESCE(med_name, 'your medication') || ' as taken.',
          'TAKEN'
        );
      END IF;

      IF caregiver_uid IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          caregiver_uid,
          'Medication Marked Taken',
          'You marked ' || COALESCE(patient_name, 'your patient') || '''s medication ' || COALESCE(med_name, 'medication') || ' as taken.',
          'TAKEN'
        );
      END IF;
    ELSE
      IF patient_uid IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          patient_uid,
          'Medication Taken',
          'You successfully took ' || COALESCE(med_name, 'your medication') || '.',
          'TAKEN'
        );
      END IF;

      IF caregiver_uid IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          caregiver_uid,
          'Medication Taken',
          COALESCE(patient_name, 'Patient') || ' took their medication ' || COALESCE(med_name, 'medication') || '.',
          'TAKEN'
        );
      END IF;
    END IF;
  ELSIF NEW.reminder_status = 'SKIPPED' THEN
    IF NEW.resolved_by = 'CAREGIVER' THEN
      IF patient_uid IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          patient_uid,
          'Medication Marked Skipped',
          'Your caregiver marked ' || COALESCE(med_name, 'your medication') || ' as skipped.',
          'SKIPPED'
        );
      END IF;

      IF caregiver_uid IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          caregiver_uid,
          'Medication Marked Skipped',
          'You marked ' || COALESCE(patient_name, 'your patient') || '''s medication ' || COALESCE(med_name, 'medication') || ' as skipped.',
          'SKIPPED'
        );
      END IF;
    ELSE
      IF patient_uid IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          patient_uid,
          'Medication Skipped',
          'You skipped ' || COALESCE(med_name, 'your medication') || '.',
          'SKIPPED'
        );
      END IF;

      IF caregiver_uid IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          caregiver_uid,
          'Medication Skipped',
          COALESCE(patient_name, 'Patient') || ' skipped their medication ' || COALESCE(med_name, 'medication') || '.',
          'SKIPPED'
        );
      END IF;
    END IF;
  ELSIF NEW.reminder_status = 'ESCALATED_TO_CG' THEN
    IF caregiver_uid IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (
        caregiver_uid,
        'Critical Escalation Alert',
        COALESCE(patient_name, 'Your patient') || ' has missed their scheduled dose of ' || COALESCE(med_name, 'medication') || '. Please verify.',
        'ESCALATED'
      );
    END IF;
  ELSIF NEW.reminder_status = 'MISSED' THEN
    IF patient_uid IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (
        patient_uid,
        'Medication Dose Missed',
        'You missed a scheduled dose of ' || COALESCE(med_name, 'your medication') || '.',
        'MISSED'
      );
    END IF;

    IF caregiver_uid IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (
        caregiver_uid,
        'Dose Confirmed Missed',
        COALESCE(patient_name, 'Patient') || ' completely missed their medication ' || COALESCE(med_name, 'medication') || '.',
        'MISSED'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
