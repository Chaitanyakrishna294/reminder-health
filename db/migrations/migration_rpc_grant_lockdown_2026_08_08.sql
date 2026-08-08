-- Batch A — RPC grant lockdown (defense-in-depth, no behaviour change for legit paths).
-- Closes three low/medium exposures from the 2026-08-08 security audit:
--   #6  check_rate_limit is anon+authenticated callable with a caller-supplied key/max/window
--       -> rate-limit poisoning / lockout DoS. Only the web rate-limit lib calls it, and that
--       lib uses the SERVICE client (web/src/lib/rate-limit.ts), so restricting to service_role
--       changes nothing for legit callers.
--   N   get_policies_debug() leaks the full RLS model (pg_policies.qual/with_check) to any
--       authenticated user. It is a debug helper with no production use -> drop it.
--   N   redeem_link_code / search_medication_catalog previously REVOKEd only `anon`, leaving
--       EXECUTE reachable via the default PUBLIC grant. REVOKE from PUBLIC and re-grant only
--       the roles that legitimately need it.
--
-- Idempotent. Safe for the bot (service_role bypasses all of this).

BEGIN;

-- #6 — check_rate_limit: service_role only.
REVOKE ALL     ON FUNCTION public.check_rate_limit(text, int, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, int, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, int, int) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.check_rate_limit(text, int, int) TO service_role;

-- N — get_policies_debug: remove the RLS-model leak entirely.
DROP FUNCTION IF EXISTS public.get_policies_debug();

-- N — redeem_link_code: authenticated only (a SECURITY DEFINER RPC that binds identity).
REVOKE ALL     ON FUNCTION public.redeem_link_code(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.redeem_link_code(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.redeem_link_code(text) TO authenticated;

-- N — search_medication_catalog: authenticated only (SECURITY INVOKER + RLS; non-sensitive,
-- but PUBLIC grant was unintended).
REVOKE ALL     ON FUNCTION public.search_medication_catalog(text, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_medication_catalog(text, int) FROM anon;
GRANT  EXECUTE ON FUNCTION public.search_medication_catalog(text, int) TO authenticated;

COMMIT;
