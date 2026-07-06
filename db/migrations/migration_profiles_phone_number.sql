-- migration_profiles_phone_number.sql
-- Guarantee the phone_number column exists on public.profiles.
--
-- Background: setup_db.sql never declared phone_number; it was only added
-- inline by migration_fix_rls.sql via ADD COLUMN IF NOT EXISTS. Environments
-- bootstrapped from setup_db.sql alone could therefore be missing it, which is
-- why the web app shipped a 42703 ("column does not exist") fallback in
-- web/src/lib/supabase/cached-queries.ts. This standalone, idempotent migration
-- makes the column's presence explicit so that fallback can be removed.

BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone_number TEXT;

COMMIT;
