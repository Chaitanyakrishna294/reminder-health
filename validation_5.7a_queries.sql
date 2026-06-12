-- Validation Queries: Sprint 5.7A — Push Notification Reliability & Observability

-- 1. Check reminder_events columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'reminder_events'
  AND column_name IN ('displayed_at', 'opened_at');

-- 2. Verify push_tracking_tokens table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'push_tracking_tokens';

-- 3. Verify push_logs table columns and status check constraints
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'push_logs'
  AND column_name = 'event_id';

SELECT cc.conname, pg_get_constraintdef(cc.oid)
FROM pg_constraint cc
JOIN pg_class c ON cc.conrelid = c.oid
WHERE c.relname = 'push_logs'
  AND cc.conname IN ('push_logs_status_check', 'push_logs_event_status_key');

-- 4. Check push logs counts by status to ensure legacy data is updated
SELECT status, COUNT(*)
FROM public.push_logs
GROUP BY status;
