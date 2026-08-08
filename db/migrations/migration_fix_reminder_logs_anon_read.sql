-- SECURITY: dose history is readable without signing in.
--
-- Evidence, taken against the live project with the PUBLIC anon key and no user session
-- (that key ships inside the browser bundle, so anyone who loads the site has it):
--
--   GET /rest/v1/reminder_logs?select=id   ->  HTTP 200,  Content-Range: 0-220/221
--   GET /rest/v1/medications?select=id     ->  HTTP 200,  Content-Range: */0
--
-- 221 rows of every user's medication adherence history, exposed. `medications` is
-- correctly locked down, which is what shows this is a policy problem specific to
-- reminder_logs rather than a project-wide misconfiguration.
--
-- The repo's own migrations already define correctly scoped policies, so the live
-- database has drifted — most likely an "Allow all selects on reminder_logs" policy
-- that migration_security_hardening_2026_07.sql was written to remove but which is
-- still present, or RLS switched off on the table. Run
-- diagnose_reminder_logs_rls.sql first if you want to see exactly which.
--
-- This migration is written to be correct regardless of which it turns out to be: it
-- forces RLS on and rebuilds SELECT policies from scratch.
--
-- Safe for the bot: the Render worker connects with the service_role key, which
-- bypasses RLS entirely. Tightening policies cannot affect reminders. The web app
-- reads with anon + a user session, which the rebuilt policies cover.

BEGIN;

ALTER TABLE public.reminder_logs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_events ENABLE ROW LEVEL SECURITY;

-- Also force it for the table owner, so a permissive owner context cannot sidestep it.
ALTER TABLE public.reminder_logs   FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_events FORCE ROW LEVEL SECURITY;

-- Drop EVERY existing SELECT policy on reminder_logs rather than guessing the name of
-- the permissive one. Anything legitimate is recreated immediately below.
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'reminder_logs'
       AND cmd IN ('SELECT','ALL')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.reminder_logs', pol.policyname);
  END LOOP;
END $$;

-- You can read a dose log if it is yours...
CREATE POLICY "Users view own logs" ON public.reminder_logs
  FOR SELECT TO authenticated
  USING (
    telegram_id IN (
      SELECT telegram_chat_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- ...or if you are an accepted, active caregiver for the patient it belongs to.
CREATE POLICY "Caregivers view patient logs" ON public.reminder_logs
  FOR SELECT TO authenticated
  USING (
    telegram_id IN (
      SELECT l.patient_telegram_id
        FROM public.active_caregiver_links l
        JOIN public.profiles p ON p.telegram_chat_id = l.caregiver_chat_id
       WHERE p.id = auth.uid()
         AND l.is_active = true
         AND l.connection_status = 'ACCEPTED'
    )
  );

COMMIT;

-- After applying, re-run the probe. It must come back with zero rows:
--   curl -s -I "$SUPABASE_URL/rest/v1/reminder_logs?select=id" \
--     -H "apikey: $ANON_KEY" -H "Prefer: count=exact" -H "Range: 0-0" | grep -i content-range
-- Expected:  Content-Range: */0
