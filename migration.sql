-- Migration: Add retry reminder columns to medications table

ALTER TABLE medications
ADD COLUMN retry_count INTEGER DEFAULT 0,
ADD COLUMN last_reminder_scheduled_at TIMESTAMPTZ;

-- Comment for explanation
COMMENT ON COLUMN medications.retry_count IS 'Tracks the number of retries sent for the current reminder cycle';
COMMENT ON COLUMN medications.last_reminder_scheduled_at IS 'The scheduled time of the reminder currently being processed/retried';
