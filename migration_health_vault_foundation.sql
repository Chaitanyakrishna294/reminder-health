-- RE-MIND-eЯ Health Vault foundation migration
-- Run this script in the Supabase SQL Editor.

-- 1. Create health_categories table
CREATE TABLE IF NOT EXISTS public.health_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_user_category_name UNIQUE (user_id, name)
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.health_categories ENABLE ROW LEVEL SECURITY;

-- 2. Row Level Security Policies for health_categories
CREATE POLICY "Users can view own categories" ON public.health_categories
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own categories" ON public.health_categories
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own categories" ON public.health_categories
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own categories" ON public.health_categories
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Expose to Data API
GRANT ALL ON public.health_categories TO authenticated;
GRANT ALL ON public.health_categories TO service_role;

-- 3. Setup trigger function for auto-provisioning default categories on profile creation
CREATE OR REPLACE FUNCTION public.handle_new_user_health_categories()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.health_categories (user_id, name, is_default)
  VALUES 
    (NEW.id, 'Prescriptions', true),
    (NEW.id, 'Lab Reports', true),
    (NEW.id, 'Scans', true),
    (NEW.id, 'Discharge Summaries', true)
  ON CONFLICT (user_id, name) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on public.profiles
DROP TRIGGER IF EXISTS on_profile_created_health_categories ON public.profiles;
CREATE TRIGGER on_profile_created_health_categories
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_health_categories();

-- 4. Backfill default categories for all existing user profiles
INSERT INTO public.health_categories (user_id, name, is_default)
SELECT id, category_name, true
FROM public.profiles
CROSS JOIN (
  VALUES 
    ('Prescriptions'), 
    ('Lab Reports'), 
    ('Scans'), 
    ('Discharge Summaries')
) AS default_categories(category_name)
ON CONFLICT (user_id, name) DO NOTHING;

-- 5. Create storage bucket health-vault
INSERT INTO storage.buckets (id, name, public)
VALUES ('health-vault', 'health-vault', false)
ON CONFLICT (id) DO NOTHING;

-- 6. Row Level Security Policies for storage.objects on health-vault bucket
DROP POLICY IF EXISTS "Users can view own vault files" ON storage.objects;
CREATE POLICY "Users can view own vault files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'health-vault' AND auth.uid() = owner);

DROP POLICY IF EXISTS "Users can insert own vault files" ON storage.objects;
CREATE POLICY "Users can insert own vault files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'health-vault' AND auth.uid() = owner);

DROP POLICY IF EXISTS "Users can update own vault files" ON storage.objects;
CREATE POLICY "Users can update own vault files" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'health-vault' AND auth.uid() = owner)
  WITH CHECK (bucket_id = 'health-vault' AND auth.uid() = owner);

DROP POLICY IF EXISTS "Users can delete own vault files" ON storage.objects;
CREATE POLICY "Users can delete own vault files" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'health-vault' AND auth.uid() = owner);
