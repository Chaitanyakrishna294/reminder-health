-- Rollback for migration_lookup_auth_guards_2026_08_13.sql
--
-- Removes the auth.uid() guard from the two directory lookups, returning them to
-- bodies that will resolve a short code into a real person's name and profile UUID
-- for ANY caller who can execute them.
--
-- There is no good reason to run this. The guard's only cost is that an
-- unauthenticated caller gets AUTH_REQUIRED instead of a row, and the sole call site
-- (settings-client-view.tsx) is behind a session either way. If something broke
-- after applying the guard, the cause is almost certainly a caller nobody knew about
-- running as service_role — which has no auth.uid() — and the fix is to find that
-- caller, not to unlock the function for everyone.
--
-- The grants are deliberately NOT restored to anon: undoing the body lock should not
-- silently undo the grant lock as well. Those are separate decisions and this file
-- only reverses one of them.

CREATE OR REPLACE FUNCTION public.lookup_profile_by_connect_code(p_code text)
RETURNS TABLE (profile_id uuid, full_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, COALESCE(p.full_name, 'User')
  FROM public.profiles p
  WHERE p.connect_code = upper(trim(p_code))
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.lookup_caregiver_by_code(p_cg_id TEXT)
RETURNS TABLE (caregiver_profile_id UUID, caregiver_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, COALESCE(p.full_name, ci.caregiver_name, 'Caregiver')
  FROM public.caregiver_info ci
  JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
  WHERE ci.caregiver_id = upper(trim(p_cg_id))
    AND ci.is_active = true
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_profile_by_connect_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lookup_profile_by_connect_code(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.lookup_profile_by_connect_code(text) TO authenticated;

REVOKE ALL ON FUNCTION public.lookup_caregiver_by_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lookup_caregiver_by_code(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.lookup_caregiver_by_code(text) TO authenticated;
