-- Rollback Migration: Sprint 5.7A — Push Notification Reliability & Observability

-- 1. Drop constraints and columns from push_logs
ALTER TABLE public.push_logs DROP CONSTRAINT IF EXISTS push_logs_event_status_key;
ALTER TABLE public.push_logs DROP CONSTRAINT IF EXISTS push_logs_status_check;

-- Restore status constraint to original
ALTER TABLE public.push_logs ADD CONSTRAINT push_logs_status_check 
CHECK (status IN ('SUCCESS', 'EXPIRED', 'FAILED'));

-- Map SENT back to SUCCESS
UPDATE public.push_logs SET status = 'SUCCESS' WHERE status = 'SENT';
-- Map DISPLAYED/OPENED to SUCCESS as a best effort rollback fallback
UPDATE public.push_logs SET status = 'SUCCESS' WHERE status IN ('DISPLAYED', 'OPENED');

ALTER TABLE public.push_logs DROP COLUMN IF EXISTS event_id;

-- 2. Drop push_tracking_tokens table
DROP TABLE IF EXISTS public.push_tracking_tokens CASCADE;

-- 3. Drop columns from reminder_events
ALTER TABLE public.reminder_events DROP COLUMN IF EXISTS displayed_at;
ALTER TABLE public.reminder_events DROP COLUMN IF EXISTS opened_at;
