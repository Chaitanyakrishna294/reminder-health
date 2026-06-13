-- Re-MIND-eЯ Sprint 5.6C.1: Rollback Script
-- Reverts: expiration cron, primary auto-assignment trigger, notification cleanup trigger

BEGIN;

-- 1. Unschedule the expiration cron job
SELECT cron.unschedule('expire-stale-requests-job')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'expire-stale-requests-job'
);

-- 2. Drop the expiration function
DROP FUNCTION IF EXISTS public.expire_stale_connection_requests();

-- 3. Drop the primary caregiver auto-assignment trigger and function
DROP TRIGGER IF EXISTS trg_auto_assign_primary_caregiver ON public.caregiver_connections;
DROP FUNCTION IF EXISTS public.auto_assign_primary_caregiver();

-- 4. Drop the notification cleanup trigger and function
DROP TRIGGER IF EXISTS trg_cleanup_resolved_notifications ON public.caregiver_connections;
DROP FUNCTION IF EXISTS public.cleanup_resolved_request_notifications();

-- Note: The backfill (is_primary = true) is NOT reverted because
-- it corrects data that should have been set originally.
-- To revert: UPDATE caregiver_connections SET is_primary = false;

COMMIT;
