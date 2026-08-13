-- Fix for migration_vault_upload_limits_2026_08_13.sql — grant EXECUTE on
-- vault_can_accept_upload() to authenticated (2026-08-13).
--
-- THE OUTAGE THIS FIXES
-- =====================
-- The vault INSERT policy calls public.vault_can_accept_upload(). That function
-- was deliberately granted to NOBODY, on the reasoning that "an RLS policy
-- expression is evaluated by the system, so it needs no EXECUTE grant".
--
-- That reasoning is WRONG. A policy expression is evaluated with the privileges
-- of the role running the query. There is no system exemption. So every
-- authenticated vault upload hit:
--
--     403  permission denied for function vault_can_accept_upload
--
-- Caught by db/scripts/verify-vault-limits.mjs, test C, minutes after apply.
--
-- SECURITY DEFINER DOES NOT HELP HERE, AND THAT IS THE WHOLE LESSON.
-- SECURITY DEFINER changes which role the function BODY runs as. It says nothing
-- about who may CALL the function — that is the EXECUTE privilege, checked
-- before the body is ever entered. The two are independent, and being definer is
-- exactly what makes it feel like the check should not apply.
--
-- The proof was sitting in the same policy. It reads:
--
--   bucket_id = 'health-vault' AND auth.uid() = owner
--   AND NOT public.is_anonymous_user() AND public.vault_can_accept_upload()
--
-- Evaluation reached the FOURTH conjunct before failing, which means the third
-- one — `is_anonymous_user()`, granted to `authenticated, anon, service_role` by
-- migration_anonymous_guests_2026_08_10.sql — was called without complaint. Same
-- position, same policy, same caller; the only difference was the grant.
--
-- IT FAILED CLOSED, which is the one good thing here: uploads were refused, not
-- silently unlimited. A privilege mistake that fails open is the one that ships
-- unnoticed. This one broke loudly on the first real call, which is also why the
-- verification script exists.
--
-- IS GRANTING IT A RISK? No. `authenticated` can now also call it directly over
-- PostgREST, where it will take a transaction advisory lock keyed on the
-- CALLER'S OWN uid and return a boolean about the caller's own vault. The lock
-- is released when that short request's transaction ends, and its key is derived
-- from auth.uid(), so the worst anyone can do with it is briefly serialise
-- themselves. The answer it returns is the same fact vault_object_count()
-- already gives them.
--
-- `anon` and PUBLIC stay revoked — both revokes, per the hard rule. anon is the
-- key shipped inside the APK, and an unauthenticated caller has no vault.
--
-- migration_vault_upload_limits_2026_08_13.sql has been corrected in place as
-- well, so re-running that file cannot recreate this outage. This standalone
-- file exists because it is what actually gets applied to a database that has
-- already run the broken version.
--
-- Idempotent; safe to re-run in the Supabase SQL Editor.
-- Companion: db/validations/validation_vault_upload_limits_2026_08_13.sql
--            (check 8 rewritten — it used to ASSERT the missing grant)
-- ============================================================================

-- Both revokes first, so this is a complete statement of the intended ACL rather
-- than an addition to whatever is currently there.
REVOKE ALL ON FUNCTION public.vault_can_accept_upload() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vault_can_accept_upload() FROM anon;

-- The caller of the INSERT is what evaluates the policy, so this is the grant
-- that makes the policy runnable at all.
GRANT EXECUTE ON FUNCTION public.vault_can_accept_upload() TO authenticated;

-- service_role never inserts into the vault (the app route only removes objects),
-- but it is not blocked from the policy path either: RLS is bypassed for that
-- role entirely, so this grant is for symmetry with vault_object_count() and to
-- keep a future server-side upload from meeting the same wall.
GRANT EXECUTE ON FUNCTION public.vault_can_accept_upload() TO service_role;

COMMENT ON FUNCTION public.vault_can_accept_upload() IS
  'True when the caller holds fewer than 5 Health Vault storage objects. Takes a per-user transaction advisory lock first, so parallel uploads cannot all read the same count and all pass. Called from the health-vault INSERT policy on storage.objects — and therefore GRANTED to authenticated, because an RLS policy expression is evaluated with the querying role''s privileges. SECURITY DEFINER changes the role the body runs as, never who may call it.';
