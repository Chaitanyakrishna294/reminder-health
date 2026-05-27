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
