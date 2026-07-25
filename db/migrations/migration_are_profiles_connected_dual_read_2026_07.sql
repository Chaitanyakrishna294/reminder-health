-- Migration: are_profiles_connected — dual-read (fixes chat for web-only pairs)
-- Date: 2026-07-26
--
-- Problem: are_profiles_connected() (migration_security_fix_rls.sql) resolved
-- connections through the LEGACY caregiver_info table only. Its live callers are
-- the two chat_messages RLS policies, so patient/caregiver pairs connected via
-- the modern web flow (caregiver_connections) could never exchange chat messages.
--
-- Fix: check caregiver_connections first (profile-UUID native, ACCEPTED+active,
-- either direction), then fall back to the legacy caregiver_info branch — the
-- same dual-read pattern the medications/vault policies use
-- (see migration_remove_role_onboarding.sql).
--
-- Idempotent — safe to re-run. Apply manually in the Supabase SQL editor.

CREATE OR REPLACE FUNCTION public.are_profiles_connected(profile_a UUID, profile_b UUID)
RETURNS BOOLEAN AS $$
DECLARE
  chat_a TEXT;
  chat_b TEXT;
BEGIN
  -- Modern web connections (caregiver_connections), either direction.
  IF EXISTS (
    SELECT 1 FROM public.caregiver_connections
    WHERE connection_status = 'ACCEPTED'
      AND is_active = true
      AND (
        (patient_profile_id = profile_a AND caregiver_profile_id = profile_b)
        OR
        (patient_profile_id = profile_b AND caregiver_profile_id = profile_a)
      )
  ) THEN
    RETURN TRUE;
  END IF;

  -- Legacy Telegram-era links (caregiver_info), matched via chat ids.
  SELECT telegram_chat_id INTO chat_a FROM public.profiles WHERE id = profile_a;
  SELECT telegram_chat_id INTO chat_b FROM public.profiles WHERE id = profile_b;

  IF chat_a IS NULL OR chat_b IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.caregiver_info
    WHERE is_active = true
      AND connection_status = 'ACCEPTED'
      AND (
        (caregiver_chat_id = chat_a AND patient_telegram_id = chat_b)
        OR
        (caregiver_chat_id = chat_b AND patient_telegram_id = chat_a)
      )
  );
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;

-- Re-assert grants (CREATE OR REPLACE preserves ACLs; stated for clarity).
REVOKE ALL ON FUNCTION public.are_profiles_connected(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.are_profiles_connected(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.are_profiles_connected(UUID, UUID) TO authenticated;
