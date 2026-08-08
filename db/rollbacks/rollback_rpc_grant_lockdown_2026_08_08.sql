-- ROLLBACK for migration_rpc_grant_lockdown_2026_08_08.sql
-- Restores the pre-lockdown grants. Note: get_policies_debug() is NOT recreated here (it is a
-- debug helper that leaks the RLS model; recreate from migration_security_fix_rls.sql only if
-- you truly need it). The other grants are restored to their prior state.

BEGIN;

-- check_rate_limit: restore anon + authenticated + service_role (prior state).
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, int, int) TO authenticated, anon, service_role;

-- redeem_link_code: prior state granted authenticated (anon was already revoked upstream).
GRANT EXECUTE ON FUNCTION public.redeem_link_code(text) TO authenticated;

-- search_medication_catalog: prior state granted authenticated (anon was already revoked upstream).
GRANT EXECUTE ON FUNCTION public.search_medication_catalog(text, int) TO authenticated;

COMMIT;
