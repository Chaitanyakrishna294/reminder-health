-- Rollback for migration_preserve_dose_history.sql
--
-- WARNING: restoring ON DELETE CASCADE re-enables the data loss this migration was
-- written to stop. Deleting a medication will once again erase every dose logged
-- against it, irreversibly. Only run this if the change has to be undone for an
-- unrelated reason, and prefer leaving the FKs alone even then.
--
-- Any medication_id already set to NULL by a delete cannot be re-linked — that
-- association is gone. Those rows keep drug_name_snapshot if you leave the columns
-- in place, which is why dropping them is commented out by default.

BEGIN;

DROP TRIGGER IF EXISTS trg_reminder_logs_snapshot   ON public.reminder_logs;
DROP TRIGGER IF EXISTS trg_reminder_events_snapshot ON public.reminder_events;
DROP FUNCTION IF EXISTS public.set_drug_name_snapshot();

ALTER TABLE public.reminder_logs   DROP CONSTRAINT IF EXISTS reminder_logs_medication_id_fkey;
ALTER TABLE public.reminder_events DROP CONSTRAINT IF EXISTS reminder_events_medication_id_fkey;

ALTER TABLE public.reminder_logs
  ADD CONSTRAINT reminder_logs_medication_id_fkey
  FOREIGN KEY (medication_id) REFERENCES public.medications(id) ON DELETE CASCADE;

ALTER TABLE public.reminder_events
  ADD CONSTRAINT reminder_events_medication_id_fkey
  FOREIGN KEY (medication_id) REFERENCES public.medications(id) ON DELETE CASCADE;

-- Deliberately NOT dropped: they are the only surviving record of what a nulled
-- history row referred to. Uncomment only if you are certain that is disposable.
-- ALTER TABLE public.reminder_logs   DROP COLUMN IF EXISTS drug_name_snapshot;
-- ALTER TABLE public.reminder_events DROP COLUMN IF EXISTS drug_name_snapshot;

COMMIT;
