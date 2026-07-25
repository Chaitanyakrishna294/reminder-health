-- Validation queries for the 2026-07-26 backbone-hardening migrations:
--   migration_push_logs_rls_2026_07.sql
--   migration_notifications_no_client_insert_2026_07.sql
--   migration_are_profiles_connected_dual_read_2026_07.sql
-- Run read-only in the Supabase SQL editor after applying; compare to "Expected".

-- 1. push_logs policies
-- Expected: exactly one SELECT policy, qual = (user_id = auth.uid()); the old
-- "Allow select push_logs for authenticated users" must be GONE.
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'push_logs';

-- 2. notifications policies
-- Expected: three policies (SELECT / UPDATE / DELETE), all scoped to
-- user_id = auth.uid(); NO INSERT policy and NO "FOR ALL" policy.
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'notifications';

-- 3. are_profiles_connected now consults caregiver_connections
-- Expected: prosrc contains 'caregiver_connections' AND 'caregiver_info'.
SELECT proname,
       prosrc LIKE '%caregiver_connections%' AS reads_modern,
       prosrc LIKE '%caregiver_info%'        AS reads_legacy,
       prosecdef                              AS security_definer
FROM pg_proc
WHERE proname = 'are_profiles_connected';

-- 4. Functional smoke test (replace the UUIDs with a real web-only pair):
-- SELECT public.are_profiles_connected('<patient-uuid>', '<caregiver-uuid>');
-- Expected: true for an ACCEPTED+active caregiver_connections pair with no
-- caregiver_info row.
