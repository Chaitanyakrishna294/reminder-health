-- Security hardening (2026-07), from Supabase advisor review.
--
-- Safe because the Render bot connects as service_role (bypasses RLS + has
-- EXECUTE on everything), and the web app calls RPCs only as `authenticated`
-- or via its own service client. Nothing below touches a path either depends on.
--
-- Verified against web/src callers before writing. Reversible (re-CREATE POLICY
-- / re-GRANT). Deferred (NOT here): link_codes RLS (needs a redeem_link_code
-- SECURITY DEFINER RPC + app change), function_search_path pinning (needs
-- per-function testing), and the Auth leaked-password toggle (dashboard).

-- 1. reminder_logs: drop the over-permissive always-true `public` policies.
--    Any logged-in user could read/insert/update EVERY user's adherence logs.
--    Scoped policies remain: "Users view/insert own logs" + "Caregivers
--    view/insert patient logs" (the latter gated on can_view_reports /
--    can_edit_medications). Web app only SELECTs these tables; writes go through
--    SECURITY DEFINER RPCs (resolve/correct_reminder_event) that bypass RLS.
DROP POLICY IF EXISTS "Allow all selects on reminder_logs" ON public.reminder_logs;
DROP POLICY IF EXISTS "Allow all inserts on reminder_logs" ON public.reminder_logs;
DROP POLICY IF EXISTS "Allow all updates on reminder_logs" ON public.reminder_logs;

-- 2. Revoke EXECUTE on public SECURITY DEFINER functions from `anon`
--    (unauthenticated). The web app never calls these while anon; the bot is
--    service_role. Handles overloads via oid::regprocedure. Also revoke from
--    `authenticated` for TRIGGER functions only (a trigger fires as the table
--    owner regardless, so the grant is meaningless and only widens the surface).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig,
           EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgfoid = p.oid) AS is_trigger
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    IF r.is_trigger THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.sig);
    END IF;
  END LOOP;
END $$;
