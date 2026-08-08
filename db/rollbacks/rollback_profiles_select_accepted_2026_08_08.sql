-- ROLLBACK for migration_profiles_select_accepted_2026_08_08.sql
-- Restores the prior is_active-only profiles SELECT policy and drops the names RPC.
-- WARNING: reverting re-opens audit #5 / M2 (profile PII readable on an unaccepted invite).
-- If you roll this back, also revert the paired requests/page.tsx edit (it will call a now-missing
-- RPC otherwise — the page tolerates the error and shows 'Unknown' names, but revert for cleanliness).

BEGIN;

DROP POLICY IF EXISTS "Allow users to read their own profile" ON public.profiles;
CREATE POLICY "Allow users to read their own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    auth.uid() = id
    OR
    id IN (
      SELECT caregiver_profile_id
      FROM public.caregiver_connections
      WHERE patient_profile_id = auth.uid() AND is_active = true

      UNION

      SELECT patient_profile_id
      FROM public.caregiver_connections
      WHERE caregiver_profile_id = auth.uid() AND is_active = true
    )
  );

DROP FUNCTION IF EXISTS public.get_connection_counterpart_names(uuid[]);

COMMIT;
