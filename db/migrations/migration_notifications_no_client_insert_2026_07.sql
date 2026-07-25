-- Migration: notifications — remove client INSERT
-- Date: 2026-07-26
--
-- Problem: "Users manage their own notifications" was FOR ALL, so any signed-in
-- user could INSERT self-addressed rows of any type (including 'ESCALATED') and
-- forge bell notifications. Docs (DATABASE_SCHEMA.md) always claimed client
-- inserts were disallowed; this makes the claim true.
--
-- Legitimate writers are unaffected:
--   * trigger functions (handle_reminder_event_state_change,
--     handle_caregiver_connection_trust_events, low-stock) are SECURITY DEFINER
--   * the bot worker and /api/care/contact-request use service_role
--
-- Idempotent — safe to re-run. Apply manually in the Supabase SQL editor.

DROP POLICY IF EXISTS "Users manage their own notifications" ON public.notifications;

DROP POLICY IF EXISTS "Users read their own notifications" ON public.notifications;
CREATE POLICY "Users read their own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- mark-as-read from the bell dropdown
DROP POLICY IF EXISTS "Users update their own notifications" ON public.notifications;
CREATE POLICY "Users update their own notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- dismiss from the bell dropdown
DROP POLICY IF EXISTS "Users delete their own notifications" ON public.notifications;
CREATE POLICY "Users delete their own notifications" ON public.notifications
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Deliberately NO INSERT policy for authenticated: notifications are produced
-- only by SECURITY DEFINER triggers and service_role.
