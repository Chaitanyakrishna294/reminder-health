-- Batch C — pin search_path on the remaining SECURITY DEFINER functions (audit N1).
-- Defense-in-depth against function/operator shadowing via a hijacked search_path. These
-- functions already reference objects schema-qualified (public.*), so practical risk is low,
-- but the client-facing RPCs are all pinned and these trigger/maintenance helpers were the
-- documented stragglers. This ALTERs only the function's search_path setting — it does NOT
-- touch any function body, so there is no behavioural change and no breakage risk.
-- Tolerant of a function being absent in a given environment (RAISE NOTICE, keep going).

DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'public.gen_connect_code()',
    'public.cleanup_rate_limits()',
    'public.cleanup_expired_link_codes()',
    'public.reassign_primary_after_revoke()',
    'public.handle_caregiver_connection_trust_events()',
    'public.auto_assign_primary_caregiver()',
    'public.handle_new_user()'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    BEGIN
      EXECUTE 'ALTER FUNCTION ' || fn || ' SET search_path = public';
      RAISE NOTICE 'pinned search_path: %', fn;
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'skip (not present in this env): %', fn;
    END;
  END LOOP;
END $$;
