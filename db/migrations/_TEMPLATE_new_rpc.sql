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
--     grant on newly created functions.
--
-- Those are two separate doors and each needs its own revoke. `REVOKE ... FROM anon`
-- does NOT remove PUBLIC-derived access — it succeeds silently and changes nothing,
-- which is how the 2026-07 hardening sweep left functions open while reporting
-- success. Always write BOTH revokes.
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
-- Both revokes, then grant only the roles that genuinely call it.
REVOKE ALL ON FUNCTION public.your_function_name(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.your_function_name(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.your_function_name(bigint) TO authenticated;
-- Only if the bot / cron actually calls it — service_role is not automatic once
-- PUBLIC has been revoked.
GRANT EXECUTE ON FUNCTION public.your_function_name(bigint) TO service_role;

-- ── THEN WRITE THE VALIDATION ───────────────────────────────────────────────
-- Ship db/validations/validation_<slug>.sql alongside, and include:
--   * NOT has_function_privilege('anon', oid, 'EXECUTE')
--   * proacl IS NOT NULL and no empty grantee (a NULL acl means PUBLIC still has it)
--   * has_function_privilege('authenticated', oid, 'EXECUTE')
--   * a COMPILE PROBE that actually calls the function — plpgsql only compiles a
--     body on first execution, so catalog checks pass happily on a function that
--     throws the moment anyone runs it. Calling it with no auth and catching
--     AUTH_REQUIRED proves the body compiles and writes nothing.
-- Write it as ONE `UNION ALL` query: the Supabase editor shows only the last
-- statement's result, so separate SELECTs hide every check but the final one.
