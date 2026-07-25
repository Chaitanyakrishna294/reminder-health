-- BASELINE: pre-repo tables (medications, reminder_logs)
-- Date: 2026-07-26
--
-- These two tables predate this repo (V1 bot era) and had no CREATE TABLE
-- anywhere — a fresh database could not be bootstrapped from db/migrations
-- alone (setup_db.sql writes policies against them). This file reconstructs
-- their PRE-REPO shape from the ALTERs in later migrations and from code usage.
--
-- ** DO NOT run against production ** — the tables already exist there
-- (IF NOT EXISTS makes it harmless, but there is no reason to).
-- For a fresh environment run this FIRST, then setup_db.sql, then the
-- migration_* files in git-history order (see APPLIED.md).
--
-- Columns added by later migrations (priority_level, retry_reminder_at,
-- delay_minutes, unit_type/current_stock/…, catalog_id/linked_*, audit cols)
-- are deliberately NOT here — the migrations add them.

CREATE TABLE IF NOT EXISTS public.medications (
  id BIGSERIAL PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  drug_name TEXT NOT NULL,
  dosage TEXT,
  frequency TEXT,                                  -- once_daily | twice_daily | thrice_daily
  reminder_times TEXT[],                           -- ['08:00','20:00'] wall-clock in `timezone`
  timezone TEXT DEFAULT 'Asia/Kolkata',
  active BOOLEAN DEFAULT TRUE,
  next_reminder_at TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ,                        -- OCC lock for exactly-once sends
  last_reminder_scheduled_at TIMESTAMPTZ,
  retry_count INTEGER DEFAULT 0,
  tablet_count INTEGER,                            -- floored mirror of current_stock (trigger)
  low_stock_alert_enabled BOOLEAN DEFAULT TRUE,    -- best-effort: live default unverified
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medications_next_reminder
  ON public.medications (next_reminder_at) WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS public.reminder_logs (
  id BIGSERIAL PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  medication_id BIGINT REFERENCES public.medications(id) ON DELETE CASCADE,
  scheduled_time TIMESTAMPTZ,
  response TEXT,                                   -- TAKEN | SKIP | MISSED
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reminder_logs_telegram_time
  ON public.reminder_logs (telegram_id, scheduled_time DESC);

-- RLS is on for both in production; policies are created by later migrations
-- (migration_fix_rls.sql, migration_remove_client_reminder_writes.sql, …).
ALTER TABLE public.medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_logs ENABLE ROW LEVEL SECURITY;
