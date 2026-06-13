-- Re-MIND-eЯ: self-heal a missing profile
-- Migration: migration_ensure_profile_selfheal.sql
--
-- Gap: handle_new_user() creates a profile only on auth signup (INSERT on auth.users). If a
-- profiles row is later deleted, the auth user is stranded — login succeeds but the app finds
-- no profile and dead-ends ("can't connect"), with no way to recover short of deleting the
-- auth user. This RPC lets the app recreate a missing profile for the current user on demand,
-- using the same defaults as handle_new_user().

BEGIN;

CREATE OR REPLACE FUNCTION public.ensure_my_profile()
RETURNS public.profiles AS $$
DECLARE
  uid  UUID := auth.uid();
  prof public.profiles%ROWTYPE;
  meta JSONB;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO prof FROM public.profiles WHERE id = uid;
  IF FOUND THEN
    RETURN prof;
  END IF;

  SELECT raw_user_meta_data INTO meta FROM auth.users WHERE id = uid;

  INSERT INTO public.profiles (id, role, full_name, telegram_chat_id)
  VALUES (
    uid,
    COALESCE(meta->>'role', 'PATIENT'),
    COALESCE(meta->>'full_name', 'User'),
    'WEB-' || uid::text
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO prof FROM public.profiles WHERE id = uid;
  RETURN prof;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.ensure_my_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_my_profile() TO authenticated;

COMMIT;
