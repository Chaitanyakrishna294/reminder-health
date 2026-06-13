-- Validation: Sprint 5.7B Caregiver Escalation & Daily Medication Closure Logic
-- Run this in your Supabase SQL Editor to check that functions exist and have correct signatures.

SELECT routine_name, pronargs, proargnames
FROM information_schema.routines r
JOIN pg_proc p ON p.proname = r.routine_name
WHERE r.routine_schema = 'public'
  AND r.routine_name IN ('scan_and_escalate_overdue_reminders', 'close_daily_medications');

-- Check returning table columns of scan_and_escalate_overdue_reminders
SELECT proname, proargnames, proallargtypes, proargmodes
FROM pg_proc 
WHERE proname = 'scan_and_escalate_overdue_reminders';
