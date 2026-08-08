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

-- reminder_events had the SAME class of exposure latent: migration.sql originally created
-- three USING(true)/WITH CHECK(true) policies ("Allow select/insert/update for authenticated
-- users"). migration_remove_client_reminder_writes.sql was written to drop them, but the
-- reminder_logs drift here proves a sibling drop can silently fail to stick on the live DB.
-- So drop them defensively by exact name (idempotent no-op if already gone), then GUARANTEE
-- the patient self-read policy exists so FORCE RLS can never lock patients out of their own
-- events. The existing caregiver SELECT policy on reminder_events ("Caregivers view patient
-- events") is left untouched — its permission gating is owned by the canonical care-circle
-- migrations (latest: migration_remove_role_onboarding.sql, gated on can_view_medications).
DROP POLICY IF EXISTS "Allow select for authenticated users" ON public.reminder_events;
DROP POLICY IF EXISTS "Allow insert for authenticated users" ON public.reminder_events;
DROP POLICY IF EXISTS "Allow update for authenticated users" ON public.reminder_events;

DROP POLICY IF EXISTS "Users view own events" ON public.reminder_events;
CREATE POLICY "Users view own events" ON public.reminder_events
  FOR SELECT TO authenticated
  USING (
    telegram_id IN (
      SELECT telegram_chat_id FROM public.profiles WHERE id = auth.uid()
    )
  );

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

-- ...or if you are an accepted, active caregiver WITH the reports permission. This is logically
-- identical to the canonical policy (migration_remove_role_onboarding.sql). An earlier draft used
-- an ungated active_caregiver_links lookup, which silently OVER-GRANTED dose-report access to
-- caregivers the patient had explicitly denied can_view_reports. The upgraded path gates on
-- can_view_reports; the legacy caregiver_info path stays as the canonical defines it (ACCEPTED).
CREATE POLICY "Caregivers view patient logs" ON public.reminder_logs
  FOR SELECT TO authenticated
  USING (
    telegram_id IN (
      -- Upgraded path (caregiver_connections), gated on the reports permission.
      SELECT p_pat.telegram_chat_id
      FROM public.caregiver_connections cc
      JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id
      WHERE cc.caregiver_profile_id = auth.uid()
        AND cc.is_active = true
        AND cc.connection_status = 'ACCEPTED'
        AND cc.can_view_reports = true

      UNION

      -- Legacy dual-read path (caregiver_info).
      SELECT ci.patient_telegram_id
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid()
        AND ci.is_active = true
        AND ci.connection_status = 'ACCEPTED'
    )
  );

COMMIT;

-- After applying, re-run the probe. It must come back with zero rows:
--   curl -s -I "$SUPABASE_URL/rest/v1/reminder_logs?select=id" \
--     -H "apikey: $ANON_KEY" -H "Prefer: count=exact" -H "Range: 0-0" | grep -i content-range
-- Expected:  Content-Range: */0
