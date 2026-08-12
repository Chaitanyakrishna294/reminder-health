-- RE-MIND-eЯ: lock correct_reminder_event to authenticated + service_role. 2026-08-13.
-- Idempotent — safe to re-run in the Supabase SQL Editor.
-- ============================================================================
--
-- WHY. validation_past_day_correction_2026_08_12.sql check 3 came back FAIL with
-- `anon` holding EXECUTE. anon is the key SHIPPED INSIDE THE APK, which anyone can
-- unpack, so anon's reach is this product's worst case. correct_reminder_event
-- rewrites dose history; it has no business being reachable by an unauthenticated
-- caller even though its own body would refuse them at AUTH_REQUIRED.
--
-- TWO REVOKES, NOT ONE, AND THAT IS THE WHOLE LESSON. A role can hold EXECUTE two
-- different ways, and each needs its own revoke:
--
--   1. VIA PUBLIC. A function whose `proacl` is NULL has Postgres's default
--      privileges, which include EXECUTE for PUBLIC — and every role is PUBLIC. You
--      cannot take that away from one role: `REVOKE ... FROM anon` against a
--      PUBLIC-derived privilege silently does NOTHING. It is not an error, it just
--      has no effect, which is the worst possible failure mode for a security
--      statement.
--   2. DIRECTLY. Supabase's own `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS
--      TO anon, authenticated, service_role` puts a real grant on newly created
--      functions. That one survives `REVOKE ... FROM PUBLIC` untouched.
--
-- migration_past_day_correction_2026_08_12.sql revoked only PUBLIC. The 2026-07
-- hardening sweep revoked only anon. Either alone leaves one of the two doors open,
-- which is how a function that BOTH migrations touched still ended up reachable.
-- Doing both is the only formulation that is correct regardless of provenance.
--
-- NOT CHANGED: the function body, its signature, its owner, or any policy. This
-- migration is four grant statements — nothing that can alter behaviour for a
-- caller who was already allowed.
-- ============================================================================

-- Belt: removes EXECUTE held via PUBLIC (and materialises the ACL if it was NULL).
REVOKE ALL ON FUNCTION public.correct_reminder_event(bigint, bigint, timestamptz, text, text) FROM PUBLIC;

-- Braces: removes a DIRECT grant, which the PUBLIC revoke above cannot reach.
REVOKE ALL ON FUNCTION public.correct_reminder_event(bigint, bigint, timestamptz, text, text) FROM anon;

-- The two roles that must keep it. `authenticated` is every real caller — the web
-- app's Change button. `service_role` is granted explicitly rather than left to
-- inheritance so the bot and the Vercel cron keep working if this function is ever
-- called server-side; it is also the role that would silently lose access if a
-- future blanket REVOKE ... FROM PUBLIC ran without re-granting.
GRANT EXECUTE ON FUNCTION public.correct_reminder_event(bigint, bigint, timestamptz, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.correct_reminder_event(bigint, bigint, timestamptz, text, text) TO service_role;
