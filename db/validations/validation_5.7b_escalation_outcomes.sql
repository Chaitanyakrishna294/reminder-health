-- Validation: Sprint 5.7B Caregiver Escalation & Adherence Outcomes
-- Run this in your Supabase SQL Editor to check that all changes have been successfully applied.

-- V1. Check that audit and telemetry columns exist on reminder_events
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'reminder_events'
  AND column_name IN ('reviewed_at', 'reviewed_from_status', 'resolution_channel');

-- V2. Check that audit, telemetry, and resolved_by columns exist on reminder_logs
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'reminder_logs'
  AND column_name IN ('reviewed_at', 'reviewed_from_status', 'resolution_channel', 'resolved_by');

-- V3. Check reminder_events check constraints
SELECT cc.conname AS constraint_name, pg_get_constraintdef(cc.oid) AS constraint_definition
FROM pg_constraint cc
JOIN pg_class cl ON cl.oid = cc.conrelid
WHERE cl.relname = 'reminder_events'
  AND cc.conname IN ('reminder_events_reminder_status_check', 'reminder_events_resolved_by_check');

-- V4. Check reminder_logs check constraints
SELECT cc.conname AS constraint_name, pg_get_constraintdef(cc.oid) AS constraint_definition
FROM pg_constraint cc
JOIN pg_class cl ON cl.oid = cc.conrelid
WHERE cl.relname = 'reminder_logs'
  AND cc.conname = 'reminder_logs_resolved_by_check';

-- V5. Verify patient_escalation_state table exists and RLS is enabled
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relname = 'patient_escalation_state';

-- V6. Verify policies on patient_escalation_state
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'patient_escalation_state';

-- V7. Verify notifications_type_check contains UNCONFIRMED
SELECT cc.conname AS constraint_name, pg_get_constraintdef(cc.oid) AS constraint_definition
FROM pg_constraint cc
JOIN pg_class cl ON cl.oid = cc.conrelid
WHERE cl.relname = 'notifications'
  AND cc.conname = 'notifications_type_check';

-- V8. Verify resolve_reminder_event RPC function signature and arguments
SELECT routine_name, pronargs, proargnames
FROM information_schema.routines r
JOIN pg_proc p ON p.proname = r.routine_name
WHERE r.routine_schema = 'public'
  AND r.routine_name = 'resolve_reminder_event';
