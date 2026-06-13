-- Re-MIND-eЯ Sprint 5.6C.1: Validation Queries
-- Run these AFTER applying migration_5.6c.1_expiration_and_primary.sql
-- Each query should return expected results as documented.

-- ============================================================================
-- V1. Verify pg_cron job is scheduled
-- Expected: 1 row with jobname = 'expire-stale-requests-job'
-- ============================================================================
SELECT jobid, jobname, schedule, command
FROM cron.job
WHERE jobname = 'expire-stale-requests-job';

-- ============================================================================
-- V2. Verify expiration function exists
-- Expected: 1 row
-- ============================================================================
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'expire_stale_connection_requests';

-- ============================================================================
-- V3. Verify auto-assignment trigger exists
-- Expected: 1 row with trigger_name = 'trg_auto_assign_primary_caregiver'
-- ============================================================================
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table = 'caregiver_connections'
  AND trigger_name = 'trg_auto_assign_primary_caregiver';

-- ============================================================================
-- V4. Verify notification cleanup trigger exists
-- Expected: 1 row with trigger_name = 'trg_cleanup_resolved_notifications'
-- ============================================================================
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table = 'caregiver_connections'
  AND trigger_name = 'trg_cleanup_resolved_notifications';

-- ============================================================================
-- V5. Verify no patient has accepted connections without a primary
-- Expected: 0 rows (every patient with accepted connections has exactly 1 primary)
-- ============================================================================
SELECT patient_profile_id, COUNT(*) AS accepted_count
FROM public.caregiver_connections
WHERE connection_status = 'ACCEPTED'
  AND is_active = true
GROUP BY patient_profile_id
HAVING patient_profile_id NOT IN (
  SELECT patient_profile_id
  FROM public.caregiver_connections
  WHERE connection_status = 'ACCEPTED'
    AND is_active = true
    AND is_primary = true
);

-- ============================================================================
-- V6. Verify unique primary constraint is intact
-- Expected: 0 rows (no patient has more than 1 active primary)
-- ============================================================================
SELECT patient_profile_id, COUNT(*) AS primary_count
FROM public.caregiver_connections
WHERE is_primary = true
  AND is_active = true
  AND connection_status = 'ACCEPTED'
GROUP BY patient_profile_id
HAVING COUNT(*) > 1;

-- ============================================================================
-- V7. Verify no stale PENDING requests exist (expires_at already passed)
-- Expected: 0 rows (if cron has run) or rows with expires_at > now() (if not yet)
-- ============================================================================
SELECT id, patient_profile_id, caregiver_profile_id, 
       connection_status, expires_at,
       CASE 
         WHEN expires_at < now() THEN 'SHOULD_BE_EXPIRED'
         ELSE 'VALID'
       END AS validity
FROM public.caregiver_connections
WHERE connection_status = 'PENDING'
  AND expires_at IS NOT NULL
ORDER BY expires_at ASC;

-- ============================================================================
-- V8. Verify no orphaned request notifications exist for resolved connections
-- Expected: 0 rows
-- ============================================================================
SELECT n.id AS notification_id, n.connection_id, n.type, n.is_read,
       cc.connection_status
FROM public.notifications n
JOIN public.caregiver_connections cc ON cc.id = n.connection_id
WHERE n.type = 'CARE_CIRCLE_ACCESS_REQUEST'
  AND cc.connection_status IN ('ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

-- ============================================================================
-- V9. Summary: All triggers on caregiver_connections
-- Expected: trg_caregiver_connections_updated_at, trg_auto_assign_primary_caregiver,
--           trg_cleanup_resolved_notifications
-- ============================================================================
SELECT trigger_name, event_manipulation, action_timing, action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table = 'caregiver_connections'
ORDER BY trigger_name;
