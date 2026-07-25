-- Migration: push_logs — drop the USING(true) read policy
-- Date: 2026-07-26
--
-- Problem: "Allow select push_logs for authenticated users" (from
-- migration_push_reliability_diagnostics.sql) was USING (true): ANY signed-in
-- user could read EVERY user's push delivery logs (user ids, error messages,
-- delivery timing). The only consumer of that cross-user read was the
-- /admin-diagnostics page, which now fetches through the service-role route
-- web/src/app/api/admin/diagnostics/route.ts, gated by the ADMIN_EMAILS env var.
--
-- After this migration: users can read only their own rows; the bot and the
-- admin route use service_role and are unaffected.
--
-- Idempotent — safe to re-run. Apply manually in the Supabase SQL editor.
-- Deploy order: deploy the web app FIRST, then apply this (the old page reads
-- push_logs directly and would break under the new policy).

DROP POLICY IF EXISTS "Allow select push_logs for authenticated users" ON public.push_logs;

DROP POLICY IF EXISTS "Users can view their own push logs" ON public.push_logs;
CREATE POLICY "Users can view their own push logs" ON public.push_logs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
