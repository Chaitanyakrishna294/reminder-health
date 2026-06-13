-- Re-MIND-eЯ: Care Circle caregiver-code lookup RPC
-- Migration: migration_carecircle_lookup_rpc.sql
--
-- P0 (web "Link Caregiver" was impossible): the web flow first read the caregiver_info row by
-- CG-ID and then the caregiver's profile. Both are RLS-protected to "already-linked" rows
-- (caregiver_info SELECT requires get_my_telegram_chat_id() match; profiles SELECT requires an
-- existing caregiver_connections link). A patient inviting a NOT-yet-linked caregiver therefore
-- got zero rows -> "Caregiver ID not found". (The Telegram bot worked only because it uses the
-- service-role key, which bypasses RLS.)
--
-- Fix: a SECURITY DEFINER resolver that returns ONLY the exact-match caregiver for a given code,
-- so the patient can resolve the invitee without exposing the caregiver directory.

BEGIN;

CREATE OR REPLACE FUNCTION public.lookup_caregiver_by_code(p_cg_id TEXT)
RETURNS TABLE (caregiver_profile_id UUID, caregiver_name TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, COALESCE(p.full_name, ci.caregiver_name, 'Caregiver')
  FROM public.caregiver_info ci
  JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
  WHERE ci.caregiver_id = upper(trim(p_cg_id))
    AND ci.is_active = true
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.lookup_caregiver_by_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_caregiver_by_code(TEXT) TO authenticated;

COMMIT;
