-- AUDIT: which public functions can `anon` execute, and by which route?
-- Read-only. Writes nothing. Run in the Supabase SQL editor.
--
-- WHY THIS EXISTS. WORK_LEDGER has said since July that the 2026-07 hardening
-- "revokes EXECUTE from anon on all SECURITY DEFINER fns". That sweep ran
--
--     REVOKE EXECUTE ON FUNCTION <sig> FROM anon
--
-- for every SECURITY DEFINER function it found. That statement removes a DIRECT
-- grant. It does NOT remove access held via PUBLIC — you cannot revoke a
-- PUBLIC-derived privilege from one role, and Postgres reports no error when you
-- try. So for any function whose privileges were still at their default (proacl
-- NULL, which implies EXECUTE to PUBLIC), the sweep was a no-op that looked like it
-- worked. The ledger's claim is therefore stronger than what was actually enforced.
--
-- anon is the key shipped inside the APK, which anyone can unpack. Its reach is this
-- product's worst case, so "which functions can it call" is worth knowing exactly
-- rather than by reputation.
--
-- HOW TO READ IT.
--   route = 'PUBLIC (default acl)'  the function has never had a GRANT/REVOKE at
--                                   all; every role can execute it.
--   route = 'PUBLIC (explicit)'     PUBLIC is named in the acl.
--   route = 'direct grant'          anon appears in the acl by name.
-- The fix differs per route, which is exactly why both revokes belong in the
-- template: REVOKE FROM PUBLIC clears the first two, REVOKE FROM anon the third.

SELECT
  p.oid::regprocedure::text AS function_signature,
  CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS security,
  CASE
    WHEN p.proacl IS NULL THEN 'PUBLIC (default acl)'
    WHEN EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) THEN 'PUBLIC (explicit)'
    ELSE 'direct grant'
  END AS anon_route,
  COALESCE(p.proacl::text, '(null — default privileges)') AS acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'                                  -- functions, not aggregates/procedures
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
ORDER BY
  -- Most dangerous first: a SECURITY DEFINER function runs as its owner, so an
  -- anon-reachable one is a way around RLS entirely.
  p.prosecdef DESC,
  p.oid::regprocedure::text;

-- Empty result = anon can execute nothing in `public`, which is the target state.
