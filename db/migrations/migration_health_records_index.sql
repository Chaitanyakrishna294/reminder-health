-- RE-MIND-eЯ Health Vault Sprint 3 Migration
-- Run this script in the Supabase SQL Editor.

-- Create composite index to optimize category timeline queries (sorting by record_date DESC)
CREATE INDEX IF NOT EXISTS idx_health_records_category_date 
ON public.health_records (category_id, record_date DESC);
