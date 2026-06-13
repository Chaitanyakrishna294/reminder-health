-- Re-MIND-eЯ Sprint 5.6C: Rollback Script
-- Reverts changes made by migration_carecircle_access_requests_phase_c.sql

BEGIN;

-- 1. Remove connection_id column from notifications
ALTER TABLE public.notifications DROP COLUMN IF EXISTS connection_id;

-- 2. Revert notifications type constraint to original
ALTER TABLE public.notifications 
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications 
ADD CONSTRAINT notifications_type_check 
CHECK (type IN ('TAKEN', 'SKIPPED', 'MISSED', 'ESCALATED'));

-- 3. Remove expires_at from caregiver_connections
ALTER TABLE public.caregiver_connections DROP COLUMN IF EXISTS expires_at;

-- 4. Revert connection_status constraint to original
ALTER TABLE public.caregiver_connections 
DROP CONSTRAINT IF EXISTS caregiver_connections_connection_status_check;

ALTER TABLE public.caregiver_connections 
ADD CONSTRAINT caregiver_connections_connection_status_check 
CHECK (connection_status IN ('PENDING', 'ACCEPTED', 'REJECTED'));

-- 5. Drop new index
DROP INDEX IF EXISTS idx_notifications_connection_id;

-- Note: The trigger function is NOT rolled back here because 
-- the new version is backward-compatible. If you need to rollback 
-- the trigger, re-apply migration_fix_reminder_event_notifications.sql.

COMMIT;
