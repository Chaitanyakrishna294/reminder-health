-- Re-MIND-eЯ Sprint 5.6D: Validation Queries
-- Run these AFTER applying migration_5.6d_trust_center.sql
-- Each query should return expected results as documented.

-- ============================================================================
-- V1. Verify RLS is enabled on caregiver_connections and caregiver_connection_audit_logs
-- Expected: 2 rows with relrowsecurity = true
-- ============================================================================
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('caregiver_connections', 'caregiver_connection_audit_logs');


-- ============================================================================
-- V2. Verify audit logs table has SELECT policy and NO insert/update/delete policies
-- Expected: Only SELECT policy rows (no insert/update/delete policies for authenticated)
-- ============================================================================
SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE tablename = 'caregiver_connection_audit_logs';


-- ============================================================================
-- V3. Verify connection validation and trust auditing triggers exist
-- Expected: 2 rows with triggers attached to caregiver_connections
-- ============================================================================
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table = 'caregiver_connections'
  AND trigger_name IN ('trg_validate_caregiver_connections', 'trg_audit_and_notify_caregiver_changes');


-- ============================================================================
-- V4. Phase 2 Audit Query: Identify any active connections in legacy path (caregiver_info)
--     that are NOT present in the new caregiver_connections table.
-- Expected: 0 rows (indicates all links are successfully synced)
-- ============================================================================
SELECT ci.id AS legacy_link_id, ci.caregiver_chat_id, ci.patient_telegram_id, ci.connection_status
FROM public.caregiver_info ci
LEFT JOIN public.caregiver_connections cc ON 
  cc.caregiver_profile_id = (SELECT id FROM public.profiles WHERE telegram_chat_id = ci.caregiver_chat_id)
  AND cc.patient_profile_id = (SELECT id FROM public.profiles WHERE telegram_chat_id = ci.patient_telegram_id)
WHERE ci.is_active = true 
  AND ci.connection_status = 'ACCEPTED'
  AND cc.id IS NULL;


-- ============================================================================
-- V5. Verify notifications constraint check supports new types
-- Expected: check constraint expression includes CARE_CIRCLE_ACCESS_GRANTED, 
--           CARE_CIRCLE_ACCESS_UPDATED, CARE_CIRCLE_ACCESS_REVOKED, CARE_CIRCLE_PRIMARY_CHANGED
-- ============================================================================
SELECT cc.conname AS constraint_name, pg_get_constraintdef(cc.oid) AS constraint_definition
FROM pg_constraint cc
JOIN pg_class cl ON cl.oid = cc.conrelid
JOIN pg_namespace ns ON ns.oid = cl.relnamespace
WHERE ns.nspname = 'public'
  AND cl.relname = 'notifications'
  AND cc.conname = 'notifications_type_check';


-- ============================================================================
-- V6. Verify updated RLS policies exist on medications, reminder_events, reminder_logs
-- Expected: 5 policy rows matching "Caregivers..."
-- ============================================================================
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename IN ('medications', 'reminder_events', 'reminder_logs')
  AND policyname LIKE 'Caregivers%';
