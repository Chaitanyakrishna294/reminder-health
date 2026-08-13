-- Rollback for migration_vault_upload_limits_2026_08_13.sql
--
-- Restores the vault INSERT policy to the ownership-only rule from
-- migration_health_vault_foundation.sql, removes the bucket ceilings, and drops
-- the two functions.
--
-- ORDER MATTERS: the policy has to stop referencing the functions before the
-- functions can be dropped, so the policy is replaced first.
--
-- THE WEB SIDE GOES BACK TOO. `vault_object_count()` is called by the vault UI's
-- "N of 5 used" counter (web/src/lib/health-vault/limits.ts and the client view).
-- Dropping it while that code is deployed leaves the counter unable to read a
-- number — it degrades to hiding itself rather than throwing, but the limit copy
-- would then be describing a rule the database is no longer enforcing, which is
-- worse than either state alone. Revert or redeploy the web at the same time.
--
-- WHAT THIS DOES NOT UNDO: nothing. No data was moved or deleted by the
-- migration, so there is nothing to restore.
-- ============================================================================

-- 1. Policy back to ownership-only (the pre-2026-08-13 rule, verbatim).
DROP POLICY IF EXISTS "Users can insert own vault files" ON storage.objects;
CREATE POLICY "Users can insert own vault files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'health-vault' AND auth.uid() = owner);

-- 2. Now the functions are unreferenced.
DROP FUNCTION IF EXISTS public.vault_can_accept_upload();
DROP FUNCTION IF EXISTS public.vault_object_count();

-- 3. Bucket ceilings off. NULL on both columns is Supabase's "no limit" — which
--    is what these buckets carried before, not a special state.
UPDATE storage.buckets
SET file_size_limit = NULL,
    allowed_mime_types = NULL
WHERE id = 'health-vault';

-- 4. Only if section 5 of the migration was actually run.
UPDATE storage.buckets
SET file_size_limit = NULL,
    allowed_mime_types = NULL
WHERE id = 'avatars';
