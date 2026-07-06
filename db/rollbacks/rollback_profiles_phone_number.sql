-- rollback_profiles_phone_number.sql
-- Undo migration_profiles_phone_number.sql by dropping the phone_number column.
--
-- WARNING: this permanently discards any stored phone numbers. Only run this if
-- you are certain no code path reads profiles.phone_number.

BEGIN;

ALTER TABLE public.profiles DROP COLUMN IF EXISTS phone_number;

COMMIT;
