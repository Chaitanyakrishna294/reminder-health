-- Batch B — stop profile PII leaking on an unaccepted invite (audit #5 / M2). CAREFUL: pairs
-- with an edit to web/src/app/(dashboard)/care-circle/requests/page.tsx (deploy them together).
--
-- THE HOLE: the profiles SELECT policy gates on is_active only, NOT connection_status='ACCEPTED'.
-- invite_caregiver() creates a PENDING, is_active=true row for any caregiver-role profile UUID,
-- which immediately satisfies the policy — so an attacker invites a victim and reads their
-- profiles row (full_name, phone_number, telegram_chat_id, connect_code) with NO acceptance.
--
-- THE FIX (two parts):
--   1. Tighten the policy to require ACCEPTED — full profile rows are visible only to yourself
--      and to counterparties of an ACCEPTED, active connection.
--   2. Add get_connection_counterpart_names(): the ONE thing the pending-requests UI legitimately
--      needs is the counterpart's display NAME. This SECURITY DEFINER RPC returns id+full_name
--      ONLY for profiles you have an active connection with (any status) — never phone_number /
--      connect_code / telegram_chat_id. The requests page calls this instead of SELECTing profiles.
--
-- Blast radius checked: the care-circle/manage page resolves names with '|| fallback' defaults and
-- keeps working (ACCEPTED partners still resolve via the policy; edge cases show a generic label).
-- The [patientId] and vault pages already gate on ACCEPTED + can_* flags explicitly.

BEGIN;

-- 1. Tighten the profiles SELECT policy: ACCEPTED + active only.
DROP POLICY IF EXISTS "Allow users to read their own profile" ON public.profiles;
CREATE POLICY "Allow users to read their own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    auth.uid() = id
    OR
    id IN (
      SELECT caregiver_profile_id
      FROM public.caregiver_connections
      WHERE patient_profile_id = auth.uid()
        AND is_active = true
        AND connection_status = 'ACCEPTED'

      UNION

      SELECT patient_profile_id
      FROM public.caregiver_connections
      WHERE caregiver_profile_id = auth.uid()
        AND is_active = true
        AND connection_status = 'ACCEPTED'
    )
  );

-- 2. Names-only resolver for the pending-requests UI. Returns id + full_name for the caller's
-- own active connections (any status), and nothing else. auth.uid() scoping means a caller can
-- only ever learn the names of people THEY are connected to — and only the name.
CREATE OR REPLACE FUNCTION public.get_connection_counterpart_names(p_ids uuid[])
RETURNS TABLE(id uuid, full_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pr.id, pr.full_name
  FROM public.profiles pr
  WHERE pr.id = ANY(p_ids)
    AND pr.id IN (
      SELECT caregiver_profile_id
      FROM public.caregiver_connections
      WHERE patient_profile_id = auth.uid() AND is_active = true

      UNION

      SELECT patient_profile_id
      FROM public.caregiver_connections
      WHERE caregiver_profile_id = auth.uid() AND is_active = true
    );
$$;

REVOKE ALL     ON FUNCTION public.get_connection_counterpart_names(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_connection_counterpart_names(uuid[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_connection_counterpart_names(uuid[]) TO authenticated;

COMMIT;
