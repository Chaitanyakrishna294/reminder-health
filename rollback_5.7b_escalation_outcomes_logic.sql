-- Rollback: Sprint 5.7B Caregiver Escalation & Daily Medication Closure Logic
-- Run this in your Supabase SQL Editor to drop the scheduler functions.

DROP FUNCTION IF EXISTS public.scan_and_escalate_overdue_reminders();
DROP FUNCTION IF EXISTS public.close_daily_medications();
