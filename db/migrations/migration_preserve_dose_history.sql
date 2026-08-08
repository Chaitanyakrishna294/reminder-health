-- Deleting a medication destroyed every dose you had ever logged for it.
--
-- reminder_logs.medication_id and reminder_events.medication_id were both declared
-- ON DELETE CASCADE, and the web "Delete" button issues a hard DELETE. So taking a
-- medication for five days and removing it on the sixth erased those five days:
-- 30-day adherence recalculated as though the doses never happened, and the history
-- was gone irreversibly. In an adherence record, the fact that a dose WAS taken has
-- to outlive the medication being discontinued.
--
-- Two changes:
--   1. The foreign keys become ON DELETE SET NULL, so history rows survive.
--   2. A drug_name_snapshot column keeps the history readable after the medication
--      row is gone — without it the surviving rows say a dose was taken but not of
--      what, which is close to useless in a medical record.
--
-- Safe to run against live data: it does not delete anything, and every statement is
-- idempotent. RLS on both tables gates on telegram_id, never on medication_id, so
-- rows with a NULL medication_id stay visible to their owner and their caregivers.
--
-- Apply in the Supabase SQL editor. Deploy the app change AFTER this runs: the code
-- reads drug_name_snapshot, and that column has to exist first.

BEGIN;

-- 1. Snapshot column, so a dose keeps its medication's name after deletion.
ALTER TABLE public.reminder_logs   ADD COLUMN IF NOT EXISTS drug_name_snapshot TEXT;
ALTER TABLE public.reminder_events ADD COLUMN IF NOT EXISTS drug_name_snapshot TEXT;

-- 2. Backfill from the medications still present. Rows whose medication was already
--    hard-deleted before this migration cannot be recovered — that history is gone.
UPDATE public.reminder_logs l
   SET drug_name_snapshot = m.drug_name
  FROM public.medications m
 WHERE l.medication_id = m.id
   AND l.drug_name_snapshot IS NULL;

UPDATE public.reminder_events e
   SET drug_name_snapshot = m.drug_name
  FROM public.medications m
 WHERE e.medication_id = m.id
   AND e.drug_name_snapshot IS NULL;

-- 3. Keep it populated automatically. Both the bot (service_role) and the web app
--    insert these rows, so a trigger is the only place that catches every writer.
CREATE OR REPLACE FUNCTION public.set_drug_name_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.drug_name_snapshot IS NULL AND NEW.medication_id IS NOT NULL THEN
    SELECT drug_name INTO NEW.drug_name_snapshot
      FROM public.medications WHERE id = NEW.medication_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reminder_logs_snapshot ON public.reminder_logs;
CREATE TRIGGER trg_reminder_logs_snapshot
  BEFORE INSERT ON public.reminder_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_drug_name_snapshot();

DROP TRIGGER IF EXISTS trg_reminder_events_snapshot ON public.reminder_events;
CREATE TRIGGER trg_reminder_events_snapshot
  BEFORE INSERT ON public.reminder_events
  FOR EACH ROW EXECUTE FUNCTION public.set_drug_name_snapshot();

-- 4. Break the cascade. The constraint name is looked up rather than assumed, because
--    an inline REFERENCES clause is auto-named and a hardcoded guess would silently
--    match nothing and leave the cascade in place — the migration would "succeed"
--    while fixing nothing.
DO $$
DECLARE
  con_name TEXT;
BEGIN
  FOR con_name IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'public.reminder_logs'::regclass
       AND c.contype  = 'f'
       AND a.attname  = 'medication_id'
  LOOP
    EXECUTE format('ALTER TABLE public.reminder_logs DROP CONSTRAINT %I', con_name);
  END LOOP;

  FOR con_name IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'public.reminder_events'::regclass
       AND c.contype  = 'f'
       AND a.attname  = 'medication_id'
  LOOP
    EXECUTE format('ALTER TABLE public.reminder_events DROP CONSTRAINT %I', con_name);
  END LOOP;
END $$;

ALTER TABLE public.reminder_logs
  ADD CONSTRAINT reminder_logs_medication_id_fkey
  FOREIGN KEY (medication_id) REFERENCES public.medications(id) ON DELETE SET NULL;

ALTER TABLE public.reminder_events
  ADD CONSTRAINT reminder_events_medication_id_fkey
  FOREIGN KEY (medication_id) REFERENCES public.medications(id) ON DELETE SET NULL;

COMMIT;
