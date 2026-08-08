-- ROLLBACK for migration_pin_search_path_2026_08_08.sql
-- Removes the per-function search_path setting (restores the prior, unpinned behaviour).
-- Reverting re-opens audit N1 (low practical risk); only run if pinning is proven to break
-- one of these functions in your environment.

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
      EXECUTE 'ALTER FUNCTION ' || fn || ' RESET search_path';
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'skip (not present): %', fn;
    END;
  END LOOP;
END $$;
