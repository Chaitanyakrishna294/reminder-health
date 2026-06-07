-- Migration: Fix profiles RLS policy infinite recursion
-- Run this in your Supabase SQL Editor to resolve the "Failed to update profile" error.

-- 1. Create a helper function to fetch the current user's telegram chat ID.
-- We use SECURITY DEFINER so that it runs with owner privileges (bypassing RLS)
-- and prevents the infinite recursion loop.
CREATE OR REPLACE FUNCTION public.get_my_telegram_chat_id()
RETURNS TEXT AS $$
BEGIN
  RETURN (SELECT telegram_chat_id FROM public.profiles WHERE id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Drop the old recursive policy on the profiles table
DROP POLICY IF EXISTS "Allow users to read their own profile" ON public.profiles;

-- 3. Create the new, non-recursive SELECT policy for the profiles table
CREATE POLICY "Allow users to read their own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    auth.uid() = id 
    OR 
    telegram_chat_id IN (
      -- Caregiver's patient
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      WHERE ci.caregiver_chat_id = public.get_my_telegram_chat_id() AND ci.is_active = true
      
      UNION
      
      -- Patient's caregiver
      SELECT caregiver_chat_id 
      FROM public.caregiver_info ci
      WHERE ci.patient_telegram_id = public.get_my_telegram_chat_id() AND ci.is_active = true
    )
  );

-- 4. Re-assert the UPDATE policy on the profiles table
DROP POLICY IF EXISTS "Allow users to update their own profile" ON public.profiles;
CREATE POLICY "Allow users to update their own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
