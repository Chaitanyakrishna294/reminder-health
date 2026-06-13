-- RE-MIND-eЯ Health Vault Stabilization Sprint Migration
-- Run this script in the Supabase SQL Editor.

-- 1. Add deleted_at column to health_records
ALTER TABLE public.health_records
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

-- 2. Create partial index for performance optimization
CREATE INDEX IF NOT EXISTS idx_health_records_active_category_date
ON public.health_records (category_id, record_date DESC)
WHERE deleted_at IS NULL;

-- 3. Stored procedure to safely audit and clean up files older than 30 days
CREATE OR REPLACE FUNCTION public.cleanup_expired_trash()
RETURNS void AS $$
BEGIN
  -- Insert audit logs for metadata record purging
  INSERT INTO public.audit_logs (user_id, action, details)
  SELECT 
    user_id, 
    'PERMANENT_DELETE', 
    jsonb_build_object(
      'record_id', id, 
      'file_name', file_name, 
      'title', title, 
      'file_url', file_url, 
      'purged_at', now()
    )
  FROM public.health_records
  WHERE deleted_at < now() - interval '30 days';

  -- Delete corresponding file from storage bucket objects table
  DELETE FROM storage.objects
  WHERE bucket_id = 'health-vault'
    AND name IN (
      SELECT file_url 
      FROM public.health_records 
      WHERE deleted_at < now() - interval '30 days'
    );

  -- Delete metadata row
  DELETE FROM public.health_records
  WHERE deleted_at < now() - interval '30 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Enable pg_cron and schedule the daily cleanup job
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove duplicate schedules if present
SELECT cron.unschedule('cleanup-expired-trash-job') 
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cleanup-expired-trash-job'
);

SELECT cron.schedule(
  'cleanup-expired-trash-job',
  '0 0 * * *',  -- Run daily at midnight
  'SELECT public.cleanup_expired_trash()'
);
