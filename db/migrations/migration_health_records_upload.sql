-- RE-MIND-eЯ Health Vault Sprint 2 migration
-- Run this script in the Supabase SQL Editor.

-- 1. Create health_records table
CREATE TABLE IF NOT EXISTS public.health_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.health_categories(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  record_date DATE NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.health_records ENABLE ROW LEVEL SECURITY;

-- 2. Row Level Security Policies for health_records
DROP POLICY IF EXISTS "Users can view own records" ON public.health_records;
CREATE POLICY "Users can view own records" ON public.health_records
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own records" ON public.health_records;
CREATE POLICY "Users can create own records" ON public.health_records
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own records" ON public.health_records;
CREATE POLICY "Users can update own records" ON public.health_records
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own records" ON public.health_records;
CREATE POLICY "Users can delete own records" ON public.health_records
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Expose to Data API
GRANT ALL ON public.health_records TO authenticated;
GRANT ALL ON public.health_records TO service_role;
