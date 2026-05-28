-- Migration: Safe Retry Reminder Architecture and Caregiver Connection System

-- 1. Safely add retry_reminder_at column to medications
ALTER TABLE medications
ADD COLUMN IF NOT EXISTS retry_reminder_at TIMESTAMPTZ;

-- 2. Safely create or update caregiver_info table
CREATE TABLE IF NOT EXISTS caregiver_info (
  id BIGSERIAL PRIMARY KEY,
  caregiver_id TEXT UNIQUE,
  caregiver_chat_id TEXT,
  caregiver_name TEXT,
  patient_telegram_id TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Safe column additions in case table already exists but lacks new columns
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='caregiver_info' AND column_name='caregiver_id') THEN
    ALTER TABLE caregiver_info ADD COLUMN caregiver_id TEXT UNIQUE;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='caregiver_info' AND column_name='caregiver_chat_id') THEN
    ALTER TABLE caregiver_info ADD COLUMN caregiver_chat_id TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='caregiver_info' AND column_name='caregiver_name') THEN
    ALTER TABLE caregiver_info ADD COLUMN caregiver_name TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='caregiver_info' AND column_name='patient_telegram_id') THEN
    ALTER TABLE caregiver_info ADD COLUMN patient_telegram_id TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='caregiver_info' AND column_name='is_active') THEN
    ALTER TABLE caregiver_info ADD COLUMN is_active BOOLEAN DEFAULT true;
  END IF;
END $$;

-- Comments for description
COMMENT ON COLUMN medications.retry_reminder_at IS 'Temporary field for retry reminder schedules to prevent drift in next_reminder_at';
COMMENT ON TABLE caregiver_info IS 'Stores caregiver registrations and their linkings to patients';
COMMENT ON COLUMN caregiver_info.caregiver_id IS 'Unique 8-character generated ID for the caregiver (e.g., CG483920)';
COMMENT ON COLUMN caregiver_info.caregiver_chat_id IS 'Telegram chat ID of the registered caregiver';
COMMENT ON COLUMN caregiver_info.caregiver_name IS 'Name of the caregiver';
COMMENT ON COLUMN caregiver_info.patient_telegram_id IS 'Telegram chat ID of the connected patient';

-- 3. Safely add delay_minutes column to reminder_logs
ALTER TABLE reminder_logs
ADD COLUMN IF NOT EXISTS delay_minutes INTEGER;

COMMENT ON COLUMN reminder_logs.delay_minutes IS 'Minutes elapsed between scheduled time and response time';

-- 4. Safely add priority_level column to medications
ALTER TABLE medications
ADD COLUMN IF NOT EXISTS priority_level TEXT DEFAULT 'normal';

COMMENT ON COLUMN medications.priority_level IS 'Medication priority level: normal, important, or critical';

-- 5. Create reminder_events table
CREATE TABLE IF NOT EXISTS reminder_events (
  id BIGSERIAL PRIMARY KEY,
  medication_id BIGINT REFERENCES medications(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ NOT NULL,
  reminder_status TEXT NOT NULL DEFAULT 'SCHEDULED',
  retry_count INTEGER NOT NULL DEFAULT 0,
  retry_reminder_at TIMESTAMPTZ,
  snooze_count INTEGER NOT NULL DEFAULT 0,
  escalated_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT, -- 'PATIENT', 'CAREGIVER', or 'SYSTEM'
  caregiver_notified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (medication_id, scheduled_for) -- Natural Idempotency Key
);

-- Index for scheduler status scans
CREATE INDEX IF NOT EXISTS idx_reminder_events_status_retry ON reminder_events (reminder_status, retry_reminder_at);

COMMENT ON TABLE reminder_events IS 'Tracks the event-driven lifecycle of scheduled reminders';

-- 6. Enable Row Level Security (RLS) and define access policies for reminder_events
ALTER TABLE reminder_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow select for authenticated users" ON reminder_events
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow insert for authenticated users" ON reminder_events
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow update for authenticated users" ON reminder_events
  FOR UPDATE TO authenticated USING (true);



