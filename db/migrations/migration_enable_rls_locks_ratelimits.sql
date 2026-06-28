-- ============================================================================
-- Security fix: enable RLS on scheduler_locks and rate_limits
--
-- Supabase advisor flagged these as RLS-disabled — i.e. readable/writable with the
-- public anon key. Verified they are accessed ONLY via SECURITY DEFINER RPCs
-- (check_rate_limit, try_acquire_scheduler_lock, release_scheduler_lock; all owned by
-- postgres) and by the service-role worker. Both bypass RLS, so enabling RLS with NO
-- policies blocks direct anon/auth access while every legitimate caller keeps working.
-- Idempotent.
-- ============================================================================

alter table public.scheduler_locks enable row level security;
alter table public.rate_limits enable row level security;
