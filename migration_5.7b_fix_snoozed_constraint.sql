-- Migration: Sprint 5.7B Fix Snoozed Status Constraint
-- Run this in your Supabase SQL Editor to allow the SNOOZED status.

ALTER TABLE public.reminder_events DROP CONSTRAINT IF EXISTS reminder_events_reminder_status_check;
ALTER TABLE public.reminder_events ADD CONSTRAINT reminder_events_reminder_status_check
  CHECK (reminder_status IN ('SENT', 'DISPLAYED', 'OPENED', 'GENTLE_REMINDER', 'ESCALATED', 'CAREGIVER_ACKNOWLEDGED', 'PENDING_REVIEW', 'UNCONFIRMED', 'TAKEN', 'SKIPPED', 'SNOOZED'));
