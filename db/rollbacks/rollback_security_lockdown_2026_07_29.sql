-- Rollback for migration_security_lockdown_2026_07_29.sql
-- WARNING: this restores the PRIOR, VULNERABLE state (client-callable scheduler
-- RPCs, forgeable caregiver_info links, self-acceptable caregiver_connections
-- requests, client dose-ledger writes). Apply only to un-break something.

BEGIN;

-- ============================================================================
-- A. Restore the default PUBLIC EXECUTE grant on the four scheduler RPCs,
--    then re-apply the (ineffective, but previously recorded) 2026-07
--    "REVOKE ... FROM anon" so the ACL matches the pre-lockdown state.
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.try_acquire_scheduler_lock(text, integer, text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_scheduler_lock(text, text)              TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_daily_medications()                       TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.scan_and_escalate_overdue_reminders()           TO PUBLIC;

REVOKE EXECUTE ON FUNCTION public.try_acquire_scheduler_lock(text, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.release_scheduler_lock(text, text)              FROM anon;
REVOKE EXECUTE ON FUNCTION public.close_daily_medications()                       FROM anon;
REVOKE EXECUTE ON FUNCTION public.scan_and_escalate_overdue_reminders()           FROM anon;

-- (The explicit service_role grants from the lockdown are harmless; left in place.)


-- ============================================================================
-- B. caregiver_info: drop the guard trigger and restore the original policies
--    exactly as defined in migration_security_fix_rls.sql (lines 147-161).
-- ============================================================================
DROP TRIGGER IF EXISTS trg_guard_caregiver_info_client_writes ON public.caregiver_info;
DROP FUNCTION IF EXISTS public.guard_caregiver_info_client_writes();

DROP POLICY IF EXISTS "Allow insert caregiver_info for own linkages" ON public.caregiver_info;
CREATE POLICY "Allow insert caregiver_info for own linkages" ON public.caregiver_info
  FOR INSERT TO authenticated
  WITH CHECK (
    caregiver_chat_id = public.get_my_telegram_chat_id()
    OR
    patient_telegram_id = public.get_my_telegram_chat_id()
  );

DROP POLICY IF EXISTS "Allow update caregiver_info for own linkages" ON public.caregiver_info;
CREATE POLICY "Allow update caregiver_info for own linkages" ON public.caregiver_info
  FOR UPDATE TO authenticated
  USING (
    caregiver_chat_id = public.get_my_telegram_chat_id()
    OR
    patient_telegram_id = public.get_my_telegram_chat_id()
  );


-- ============================================================================
-- C. Restore the caregiver_connections INSERT policy exactly as defined in
--    migration_5.6d_trust_center.sql (lines 76-81).
-- ============================================================================
DROP POLICY IF EXISTS "Caregivers can request connection" ON public.caregiver_connections;
CREATE POLICY "Caregivers can request connection" ON public.caregiver_connections
  FOR INSERT TO authenticated
  WITH CHECK (
    caregiver_profile_id = auth.uid()
    AND connection_status = 'PENDING'
  );


-- ============================================================================
-- D. Drop the legacy-mirror revoke trigger.
-- ============================================================================
DROP TRIGGER IF EXISTS trg_deactivate_legacy_caregiver_link_on_revoke ON public.caregiver_connections;
DROP FUNCTION IF EXISTS public.deactivate_legacy_caregiver_link_on_revoke();


-- ============================================================================
-- E. Restore the two write policies exactly as last defined in
--    migration_remove_role_onboarding.sql (lines 499-519 and 544-565).
--    The extra defensive drops in section E of the lockdown are NOT restored:
--    those policies were already removed by
--    migration_remove_client_reminder_writes.sql before the lockdown existed.
-- ============================================================================
DROP POLICY IF EXISTS "Caregivers resolve patient events" ON public.reminder_events;
CREATE POLICY "Caregivers resolve patient events" ON public.reminder_events
  FOR UPDATE TO authenticated
  USING (
    telegram_id IN (
      SELECT p_pat.telegram_chat_id
      FROM public.caregiver_connections cc
      JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id
      WHERE cc.caregiver_profile_id = auth.uid()
        AND cc.is_active = true
        AND cc.connection_status = 'ACCEPTED'
        AND (cc.can_edit_medications = true OR cc.can_receive_escalations = true)

      UNION

      SELECT patient_telegram_id
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND ci.is_active = true AND ci.connection_status = 'ACCEPTED'
    )
  );

DROP POLICY IF EXISTS "Caregivers insert patient logs" ON public.reminder_logs;
CREATE POLICY "Caregivers insert patient logs" ON public.reminder_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    telegram_id IN (
      SELECT p_pat.telegram_chat_id
      FROM public.caregiver_connections cc
      JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id
      WHERE cc.caregiver_profile_id = auth.uid()
        AND cc.is_active = true
        AND cc.connection_status = 'ACCEPTED'
        AND (cc.can_edit_medications = true OR cc.can_receive_escalations = true)

      UNION

      SELECT patient_telegram_id
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND ci.is_active = true AND ci.connection_status = 'ACCEPTED'
    )
  );

COMMIT;
