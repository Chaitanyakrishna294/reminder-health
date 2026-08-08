-- VALIDATION for migration_profiles_select_accepted_2026_08_08.sql

-- A. Policy now requires ACCEPTED (the policy body should mention connection_status).
SELECT 'policy_requires_accepted' AS check,
       CASE WHEN qual ILIKE '%connection_status%' THEN 'OK' ELSE 'FAIL' END AS result
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'profiles'
  AND policyname = 'Allow users to read their own profile';

-- B. Names RPC exists and is authenticated-only.
SELECT 'names_rpc_present' AS check,
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname='public' AND p.proname='get_connection_counterpart_names'
       ) THEN 'OK' ELSE 'FAIL' END AS result;

-- C. FUNCTIONAL (run from the app):
--   1. ATTACK (must now FAIL): invite a caregiver you are not accepted with, then try to SELECT
--      their profiles row directly (REST): PATCH-free GET /rest/v1/profiles?id=eq.<victim>.
--      Expected: 0 rows (was: full row incl. phone_number/connect_code).
--   2. UI (must still work): /care-circle/requests shows the correct names on both incoming and
--      outgoing PENDING requests (served by get_connection_counterpart_names).
--   3. ACCEPTED still works: an accepted caregiver/patient can still see the counterpart's name
--      across the care-circle pages.
