-- Re-MIND-eЯ: retire the ungated legacy caregiver_info branch from the caregiver read policies
-- Migration: migration_caregiver_legacy_branch_gated_2026_08_11.sql
-- M3 hardening, the item CLAUDE.md flags as must-resolve before any Android caregiver feature.
--
-- THE PROBLEM. Three caregiver SELECT policies are shaped like this:
--
--     telegram_id IN (
--       SELECT ... FROM caregiver_connections cc
--        WHERE ... AND cc.can_view_medications = true      -- upgraded path, GATED
--       UNION
--       SELECT ... FROM caregiver_info ci
--        WHERE ci.is_active AND ci.connection_status = 'ACCEPTED'   -- legacy path, UNGATED
--     )
--
-- A UNION grants if EITHER branch matches. So any caregiver holding an accepted legacy
-- caregiver_info row could read the patient's medications, dose events and adherence history
-- REGARDLESS of the can_* flags — the patient's own permission toggles were decorative for that
-- relationship. Three policies affected:
--
--   medications      "Caregivers can view patient medications"  (modern gate: can_view_medications)
--   reminder_events  "Caregivers view patient events"           (modern gate: can_view_medications)
--   reminder_logs    "Caregivers view patient logs"             (modern gate: can_view_reports)
--
-- AUDIT FIRST, FIX SECOND (db/audits/audit_rls_caregiver_dual_read_2026_08_11.sql, run 2026-08-11):
--   Q1 = 3   legacy rows currently granting access
--   Q2 = 0   ...with no modern caregiver_connections counterpart
--   Q3 = 0   live over-grants against can_view_reports
--   Q4 = 0   live over-grants against can_view_medications
--
-- So the modern branch already grants everything the legacy branch grants, with the flags
-- honoured. Removing the legacy branch is a no-op for every existing relationship AND closes the
-- bypass permanently. Fixing it now — while the count is zero — is the cheap moment; once a
-- patient revokes a permission and the legacy row silently overrides it, this becomes an incident
-- with data already read.
--
-- WHY NOT "JUST GATE THE LEGACY BRANCH". caregiver_info has no can_* columns — it predates them.
-- Gating it would mean joining back to caregiver_connections for the flag, which is precisely the
-- upgraded branch. The gated legacy branch IS the modern branch, so keeping both is duplication
-- that can only drift apart again.
--
-- SAFE BY CONSTRUCTION. The audit is a snapshot and its Q2 join silently skips legacy rows whose
-- profiles do not resolve. Rather than trust that, section 1 below RE-CHECKS at apply time and
-- ABORTS THE WHOLE TRANSACTION if even one relationship would lose access. A caregiver losing
-- visibility can mean a missed escalation, so this migration would rather refuse to run than
-- quietly cut someone off. If it aborts, do not force it — investigate the rows it reports.
--
-- NOT CHANGED: the patient self-read policies, every write path (events/logs are mutated only
-- through SECURITY DEFINER RPCs), and caregiver_info itself, which stays in place and is still
-- read by correct_reminder_event and the care-circle UI. This migration narrows RLS only.
--
-- Apply in the Supabase SQL editor, then run
-- db/validations/validation_caregiver_legacy_branch_gated_2026_08_11.sql.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Refuse to proceed if anyone would lose access.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_lost_meds  INTEGER;
  v_lost_repts INTEGER;
  v_detail     TEXT;
BEGIN
  -- A legacy relationship "would lose medications/events access" if, after the legacy branch is
  -- gone, no modern connection grants it. Deliberately NOT joining through the patient's profile
  -- for the legacy side, so a legacy row whose patient profile is missing still counts as a loss
  -- rather than vanishing from the check (the gap in the audit's Q2).
  SELECT COUNT(*), string_agg(DISTINCT ci.caregiver_chat_id || '->' || ci.patient_telegram_id, ', ')
    INTO v_lost_meds, v_detail
  FROM public.caregiver_info ci
  WHERE ci.is_active = true
    AND ci.connection_status = 'ACCEPTED'
    AND NOT EXISTS (
      SELECT 1
      FROM public.caregiver_connections cc
      JOIN public.profiles p_cg  ON p_cg.id  = cc.caregiver_profile_id
      JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id
      WHERE p_cg.telegram_chat_id  = ci.caregiver_chat_id
        AND p_pat.telegram_chat_id = ci.patient_telegram_id
        AND cc.is_active = true
        AND cc.connection_status = 'ACCEPTED'
        AND cc.can_view_medications = true
    );

  IF v_lost_meds > 0 THEN
    RAISE EXCEPTION
      'ABORTED: % legacy caregiver relationship(s) would LOSE medications/events access. Pairs (caregiver->patient): %. Backfill caregiver_connections with can_view_medications for these before re-running. Nothing was changed.',
      v_lost_meds, v_detail;
  END IF;

  SELECT COUNT(*), string_agg(DISTINCT ci.caregiver_chat_id || '->' || ci.patient_telegram_id, ', ')
    INTO v_lost_repts, v_detail
  FROM public.caregiver_info ci
  WHERE ci.is_active = true
    AND ci.connection_status = 'ACCEPTED'
    AND NOT EXISTS (
      SELECT 1
      FROM public.caregiver_connections cc
      JOIN public.profiles p_cg  ON p_cg.id  = cc.caregiver_profile_id
      JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id
      WHERE p_cg.telegram_chat_id  = ci.caregiver_chat_id
        AND p_pat.telegram_chat_id = ci.patient_telegram_id
        AND cc.is_active = true
        AND cc.connection_status = 'ACCEPTED'
        AND cc.can_view_reports = true
    );

  IF v_lost_repts > 0 THEN
    RAISE EXCEPTION
      'ABORTED: % legacy caregiver relationship(s) would LOSE dose-report access. Pairs (caregiver->patient): %. Backfill caregiver_connections with can_view_reports for these before re-running. Nothing was changed.',
      v_lost_repts, v_detail;
  END IF;

  RAISE NOTICE 'Pre-flight OK: no caregiver relationship loses access by removing the legacy branch.';
END $$;

-- ---------------------------------------------------------------------------
-- 2. medications — "Caregivers can view patient medications"
-- ---------------------------------------------------------------------------
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
    )
  );

-- ---------------------------------------------------------------------------
-- 3. reminder_events — "Caregivers view patient events"
-- ---------------------------------------------------------------------------
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
    )
  );

-- ---------------------------------------------------------------------------
-- 4. reminder_logs — "Caregivers view patient logs"
--    Note the different flag: adherence history is gated on can_view_reports, not
--    can_view_medications. Preserved exactly as the canonical definition had it.
-- ---------------------------------------------------------------------------
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
    )
  );

COMMIT;
