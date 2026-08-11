-- Rollback for migration_caregiver_legacy_branch_gated_2026_08_11.sql
--
-- Restores the three caregiver SELECT policies to their previous definitions, legacy
-- caregiver_info UNION branch and all, exactly as migration_remove_role_onboarding.sql (for
-- medications / reminder_events) and migration_fix_reminder_logs_anon_read.sql (for reminder_logs)
-- last defined them.
--
-- WHAT ROLLING BACK RE-OPENS: the legacy branch is gated on nothing but ACCEPTED + is_active, so
-- any caregiver holding an accepted caregiver_info row can once again read the patient's
-- medications, dose events and adherence history REGARDLESS of that patient's can_view_medications
-- / can_view_reports settings. The audit on 2026-08-11 measured zero relationships depending on
-- that branch (Q2=0) and zero currently over-granted (Q3=Q4=0), so rolling back restores a bypass
-- that benefits nobody. Only use this if removing the branch is shown to have broken real
-- caregiver access — and prefer backfilling the missing caregiver_connections row instead, which
-- fixes the cause rather than reinstating the bypass.

BEGIN;

DROP POLICY IF EXISTS "Caregivers can view patient medications" ON public.medications;
CREATE POLICY "Caregivers can view patient medications" ON public.medications
  FOR SELECT TO authenticated
  USING (
    telegram_id IN (
      SELECT p_pat.telegram_chat_id
      FROM public.caregiver_connections cc
      JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id
      WHERE cc.caregiver_profile_id = auth.uid()
        AND cc.is_active = true
        AND cc.connection_status = 'ACCEPTED'
        AND cc.can_view_medications = true

      UNION

      SELECT patient_telegram_id
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND ci.is_active = true AND ci.connection_status = 'ACCEPTED'
    )
  );

DROP POLICY IF EXISTS "Caregivers view patient events" ON public.reminder_events;
CREATE POLICY "Caregivers view patient events" ON public.reminder_events
  FOR SELECT TO authenticated
  USING (
    telegram_id IN (
      SELECT p_pat.telegram_chat_id
      FROM public.caregiver_connections cc
      JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id
      WHERE cc.caregiver_profile_id = auth.uid()
        AND cc.is_active = true
        AND cc.connection_status = 'ACCEPTED'
        AND cc.can_view_medications = true

      UNION

      SELECT patient_telegram_id
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid() AND ci.is_active = true AND ci.connection_status = 'ACCEPTED'
    )
  );

DROP POLICY IF EXISTS "Caregivers view patient logs" ON public.reminder_logs;
CREATE POLICY "Caregivers view patient logs" ON public.reminder_logs
  FOR SELECT TO authenticated
  USING (
    telegram_id IN (
      SELECT p_pat.telegram_chat_id
      FROM public.caregiver_connections cc
      JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id
      WHERE cc.caregiver_profile_id = auth.uid()
        AND cc.is_active = true
        AND cc.connection_status = 'ACCEPTED'
        AND cc.can_view_reports = true

      UNION

      SELECT ci.patient_telegram_id
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid()
        AND ci.is_active = true
        AND ci.connection_status = 'ACCEPTED'
    )
  );

COMMIT;
