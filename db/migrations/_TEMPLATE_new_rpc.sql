-- TEMPLATE — copy this when adding a client-callable RPC. Not a migration itself.
-- Rename to migration_<slug>_<YYYY_MM_DD>.sql and delete what does not apply.
-- ============================================================================
--
-- The footer at the bottom is the point of this file. A new function starts
-- EXECUTABLE BY EVERYONE and there is no error to tell you so:
--
--   * Postgres's default for a function with no ACL is EXECUTE to PUBLIC, and every
--     role is PUBLIC — including `anon`, the key shipped inside the APK.
--   * Supabase additionally runs `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT
--     ALL ON FUNCTIONS TO anon, authenticated, service_role`, which puts a DIRECT
--     grant on newly created functions — to ALL THREE of those roles.
--
-- So the rule generalises past anon: WRITING NO GRANT DOES NOT MEAN NO GRANT, for
-- any role in that list. If service_role is not a caller, revoke it by name too —
-- commenting "no service_role grant" changes nothing, and on 2026-08-14
-- `resend_caregiver_request` shipped with exactly that comment above an ACL that
-- read `service_role=X/postgres`. Validation check 4 is what found it.
--
-- PUBLIC and anon are separate doors and each needs its own revoke. `REVOKE ...
-- FROM anon` does NOT remove PUBLIC-derived access — it succeeds silently and
-- changes nothing, which is how the 2026-07 hardening sweep left functions open
-- while reporting success. Always write both, plus service_role per the note
-- above whenever the bot and the cron are not callers.
--
-- ============================================================================
--
-- AND THE OTHER HALF, WHICH COSTS AN OUTAGE INSTEAD OF A LEAK:
--
--   IF AN RLS POLICY CALLS YOUR FUNCTION, THE CALLER STILL NEEDS EXECUTE ON IT.
--
-- A policy expression is evaluated with the privileges of the role running the
-- query. There is no system exemption, and SECURITY DEFINER does not provide one
-- — DEFINER governs which role the BODY runs as, which is checked AFTER the
-- EXECUTE privilege, not instead of it. Being definer is exactly what makes it
-- feel like the rule should not apply.
--
-- Paid for on 2026-08-13: `vault_can_accept_upload()` was granted to nobody "because
-- the policy evaluates it, not the client", and every authenticated Health Vault
-- upload failed with `permission denied for function vault_can_accept_upload`.
-- The counter-example was in the same policy — `is_anonymous_user()`, one conjunct
-- earlier, carries a grant to `authenticated` and evaluated fine.
--
-- It fails CLOSED, which is the good half: loud, immediate, and caught by the first
-- real call. Contrast the missing-revoke bug above, which fails open and silently.
--
-- So: a function referenced by a policy is granted to every role that performs the
-- guarded operation — usually `authenticated`. Lock it at the grant by naming those
-- roles, never by granting nobody. And have the validation assert it, generically:
-- read the function names out of `pg_get_expr(polwithcheck, polrelid)` and check
-- `has_function_privilege('authenticated', …)` for each, so a conjunct added later
-- is covered without editing the check. See
-- db/validations/validation_vault_upload_limits_2026_08_13.sql check 13.
--
-- ============================================================================

-- CREATE OR REPLACE, never DROP+CREATE, on anything scheduler- or dose-adjacent:
-- a DROP takes the grants with it and a concurrent caller sees the function vanish.
CREATE OR REPLACE FUNCTION public.your_function_name(
  p_example bigint
)
RETURNS TABLE(example_out bigint)
LANGUAGE plpgsql
SECURITY DEFINER
-- Pin search_path on every SECURITY DEFINER function, or a caller-controlled path
-- can point your unqualified names at their own objects.
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  -- Authenticate first. SECURITY DEFINER means this body runs as the owner, so the
  -- function is the only thing standing between a caller and the whole table.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  -- NOTE ON RETURNS TABLE: its column names become OUT variables inside the body, so
  -- any reference to a table column of the same name is ambiguous and fails at
  -- RUNTIME with 42702 — not at creation. Qualify them: public.your_table.status,
  -- never bare `status`. This has cost this project a shipped-broken RPC once.

  RETURN QUERY SELECT 1::bigint;
END;
$function$;

-- ── PRIVILEGE FOOTER — REQUIRED ON EVERY FUNCTION ───────────────────────────
-- Revoke all three FIRST, so what follows is a complete statement of the intended
-- ACL rather than a diff against whatever Supabase's default privileges left.
REVOKE ALL ON FUNCTION public.your_function_name(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.your_function_name(bigint) FROM anon;
REVOKE ALL ON FUNCTION public.your_function_name(bigint) FROM service_role;

-- Then grant back ONLY the roles that genuinely call it.
GRANT EXECUTE ON FUNCTION public.your_function_name(bigint) TO authenticated;
-- UNCOMMENT ONLY IF the bot or the cron actually calls this. Leaving it commented
-- is now meaningful: the revoke above is what makes silence mean "no".
-- GRANT EXECUTE ON FUNCTION public.your_function_name(bigint) TO service_role;
-- If an RLS POLICY calls this function, `authenticated` above is REQUIRED, not
-- optional — see the second half of the header. "Nobody calls it directly" is not
-- a reason to grant nobody; the policy is called by the client's own query.

-- ── THEN WRITE THE VALIDATION ───────────────────────────────────────────────
-- Ship db/validations/validation_<slug>.sql alongside, and include:
--   * NOT has_function_privilege('anon', oid, 'EXECUTE')
--   * NOT has_function_privilege('service_role', …) when it is not a caller — the
--     check that caught resend_caregiver_request on 2026-08-14
--   * proacl IS NOT NULL and no empty grantee (a NULL acl means PUBLIC still has it)
--   * has_function_privilege('authenticated', oid, 'EXECUTE')
--   * a COMPILE PROBE that actually calls the function — plpgsql only compiles a
--     body on first execution, so catalog checks pass happily on a function that
--     throws the moment anyone runs it. Calling it with no auth and catching
--     AUTH_REQUIRED proves the body compiles and writes nothing.
-- Write it as ONE `UNION ALL` query: the Supabase editor shows only the last
-- statement's result, so separate SELECTs hide every check but the final one.
