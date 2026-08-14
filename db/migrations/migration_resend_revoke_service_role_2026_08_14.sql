-- Revoke service_role EXECUTE on resend_caregiver_request (2026-08-14).
--
-- Caught by check 4 of validation_resend_caregiver_request_2026_08_14.sql, which
-- came back FAIL with:
--
--   {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--
-- The migration that created the function wrote NO `GRANT ... TO service_role`,
-- and said in its own footer that service_role was deliberately not granted.
-- It was granted anyway.
--
-- THE THIRD DOOR. Supabase runs
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
-- so a newly created function arrives with a DIRECT grant to all three roles
-- before anyone has written a single GRANT. The house rule has always been "both
-- revokes" — PUBLIC and anon — because those are the two that leak to the key
-- shipped inside the APK. But the rule's real content is that THE ABSENCE OF A
-- GRANT IS NOT THE ABSENCE OF A GRANT, and that applies to service_role
-- identically. Writing nothing grants everything, three times over.
--
-- Milder than the anon case: service_role is server-side only and bypasses RLS
-- anyway, so this is not a leak. It is fixed regardless, because the file said
-- one thing and the database did another — and a privilege footer that describes
-- an ACL the database does not have is worse than no comment at all. Nothing
-- server-side resends a human's invitation: the bot and the cron have no reason
-- to re-notify someone about access to another person's medication history.
--
-- Idempotent; safe to re-run in the Supabase SQL Editor.
-- After applying, re-run validation_resend_caregiver_request_2026_08_14.sql —
-- check 4 should read DONE.
-- ============================================================================

REVOKE ALL ON FUNCTION public.resend_caregiver_request(uuid) FROM service_role;

-- Re-stated so this file is a complete description of the intended ACL rather
-- than a diff against whatever happens to be there.
REVOKE ALL ON FUNCTION public.resend_caregiver_request(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resend_caregiver_request(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.resend_caregiver_request(uuid) TO authenticated;
