-- Migration: Sprint 5.7A — Push Notification Reliability & Observability

-- 1. Add displayed_at and opened_at to public.reminder_events for native analytics
ALTER TABLE public.reminder_events ADD COLUMN IF NOT EXISTS displayed_at TIMESTAMPTZ NULL;
ALTER TABLE public.reminder_events ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.reminder_events.displayed_at IS 'Timestamp when the notification was displayed on the user device';
COMMENT ON COLUMN public.reminder_events.opened_at IS 'Timestamp when the user clicked/opened the notification';

-- 2. Create the push_tracking_tokens table for secure client callback authentication
CREATE TABLE IF NOT EXISTS public.push_tracking_tokens (
    event_id BIGINT NOT NULL REFERENCES public.reminder_events(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for expiration purging checks
CREATE INDEX IF NOT EXISTS idx_push_tracking_tokens_expires_at ON public.push_tracking_tokens(expires_at);

-- Enable RLS on push_tracking_tokens to secure the token hashes
ALTER TABLE public.push_tracking_tokens ENABLE ROW LEVEL SECURITY;

-- No policies defined, meaning only service role can read/write push_tracking_tokens

-- 3. Expand public.push_logs table for event tracking & uniqueness
ALTER TABLE public.push_logs ADD COLUMN IF NOT EXISTS event_id BIGINT REFERENCES public.reminder_events(id) ON DELETE SET NULL;

-- Drop existing status constraint
ALTER TABLE public.push_logs DROP CONSTRAINT IF EXISTS push_logs_status_check;

-- Map legacy success logs to SENT
UPDATE public.push_logs SET status = 'SENT' WHERE status = 'SUCCESS';

-- Add updated status constraint
ALTER TABLE public.push_logs ADD CONSTRAINT push_logs_status_check 
CHECK (status IN ('SENT', 'DISPLAYED', 'OPENED', 'EXPIRED', 'FAILED'));

-- Add uniqueness constraint to block duplicate service worker log retries
ALTER TABLE public.push_logs DROP CONSTRAINT IF EXISTS push_logs_event_status_key;
ALTER TABLE public.push_logs ADD CONSTRAINT push_logs_event_status_key UNIQUE (event_id, status);

-- Indices for push_logs
CREATE INDEX IF NOT EXISTS idx_push_logs_event_id ON public.push_logs(event_id);
CREATE INDEX IF NOT EXISTS idx_push_logs_status ON public.push_logs(status);
