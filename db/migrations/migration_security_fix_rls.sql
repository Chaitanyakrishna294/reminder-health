-- Migration: Security Fixes for caregiver_info, profiles, and chat_messages RLS Policies (Idempotent Version)
-- Run this in your Supabase SQL Editor to apply the changes.

-- ==========================================
-- 1. Helper Functions with Hardened Settings
-- ==========================================

-- Helper 1: Retrieve user's registered Telegram Chat ID
CREATE OR REPLACE FUNCTION public.get_my_telegram_chat_id()
RETURNS TEXT AS $$
BEGIN
  RETURN (SELECT telegram_chat_id FROM public.profiles WHERE id = auth.uid());
END;
$$ LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = public;

-- Restrict execution to authenticated users only
REVOKE ALL ON FUNCTION public.get_my_telegram_chat_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_telegram_chat_id() TO authenticated;


-- Helper 2: Verify active/accepted caregiver connection between profiles
CREATE OR REPLACE FUNCTION public.are_profiles_connected(profile_a UUID, profile_b UUID)
RETURNS BOOLEAN AS $$
DECLARE
  chat_a TEXT;
  chat_b TEXT;
BEGIN
  SELECT telegram_chat_id INTO chat_a FROM public.profiles WHERE id = profile_a;
  SELECT telegram_chat_id INTO chat_b FROM public.profiles WHERE id = profile_b;
  
  IF chat_a IS NULL OR chat_b IS NULL THEN
    RETURN FALSE;
  END IF;
  
  RETURN EXISTS (
    SELECT 1 FROM public.caregiver_info
    WHERE is_active = true
      AND connection_status = 'ACCEPTED'
      AND (
        (caregiver_chat_id = chat_a AND patient_telegram_id = chat_b)
        OR
        (caregiver_chat_id = chat_b AND patient_telegram_id = chat_a)
      )
  );
END;
$$ LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = public;

-- Restrict execution to authenticated users only
REVOKE ALL ON FUNCTION public.are_profiles_connected(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.are_profiles_connected(UUID, UUID) TO authenticated;


-- ==========================================
-- 2. profiles Table SELECT & UPDATE Policies
-- ==========================================

DROP POLICY IF EXISTS "Allow users to read their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Allow users to read their own profile" ON profiles;
DROP POLICY IF EXISTS "Allow users to read their own profile" ON "public"."profiles";
CREATE POLICY "Allow users to read their own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    auth.uid() = id 
    OR 
    telegram_chat_id IN (
      SELECT patient_telegram_id 
      FROM public.caregiver_info ci
      WHERE ci.caregiver_chat_id = public.get_my_telegram_chat_id() AND ci.is_active = true
      
      UNION
      
      SELECT caregiver_chat_id 
      FROM public.caregiver_info ci
      WHERE ci.patient_telegram_id = public.get_my_telegram_chat_id() AND ci.is_active = true
    )
  );

DROP POLICY IF EXISTS "Allow users to update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Allow users to update their own profile" ON profiles;
DROP POLICY IF EXISTS "Allow users to update their own profile" ON "public"."profiles";
CREATE POLICY "Allow users to update their own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);


-- ==========================================
-- 3. caregiver_info Table RLS Policies
-- ==========================================

-- Drop legacy permissive policies (including 'Allow all...' variants)
DROP POLICY IF EXISTS "Allow select caregiver_info for authenticated users" ON public.caregiver_info;
DROP POLICY IF EXISTS "Allow select caregiver_info for authenticated users" ON caregiver_info;
DROP POLICY IF EXISTS "Allow select caregiver_info for authenticated users" ON "public"."caregiver_info";
DROP POLICY IF EXISTS "Allow insert caregiver_info for authenticated users" ON public.caregiver_info;
DROP POLICY IF EXISTS "Allow insert caregiver_info for authenticated users" ON caregiver_info;
DROP POLICY IF EXISTS "Allow insert caregiver_info for authenticated users" ON "public"."caregiver_info";
DROP POLICY IF EXISTS "Allow update caregiver_info for authenticated users" ON public.caregiver_info;
DROP POLICY IF EXISTS "Allow update caregiver_info for authenticated users" ON caregiver_info;
DROP POLICY IF EXISTS "Allow update caregiver_info for authenticated users" ON "public"."caregiver_info";

DROP POLICY IF EXISTS "Allow all selects on caregiver_info" ON public.caregiver_info;
DROP POLICY IF EXISTS "Allow all selects on caregiver_info" ON caregiver_info;
DROP POLICY IF EXISTS "Allow all selects on caregiver_info" ON "public"."caregiver_info";
DROP POLICY IF EXISTS "Allow all inserts on caregiver_info" ON public.caregiver_info;
DROP POLICY IF EXISTS "Allow all inserts on caregiver_info" ON caregiver_info;
DROP POLICY IF EXISTS "Allow all inserts on caregiver_info" ON "public"."caregiver_info";
DROP POLICY IF EXISTS "Allow all updates on caregiver_info" ON public.caregiver_info;
DROP POLICY IF EXISTS "Allow all updates on caregiver_info" ON caregiver_info;
DROP POLICY IF EXISTS "Allow all updates on caregiver_info" ON "public"."caregiver_info";

-- Drop legacy permissive policies on medications
DROP POLICY IF EXISTS "Allow all selects on medications" ON public.medications;
DROP POLICY IF EXISTS "Allow all selects on medications" ON medications;
DROP POLICY IF EXISTS "Allow all selects on medications" ON "public"."medications";
DROP POLICY IF EXISTS "Allow all inserts on medications" ON public.medications;
DROP POLICY IF EXISTS "Allow all inserts on medications" ON medications;
DROP POLICY IF EXISTS "Allow all inserts on medications" ON "public"."medications";
DROP POLICY IF EXISTS "Allow all updates on medications" ON public.medications;
DROP POLICY IF EXISTS "Allow all updates on medications" ON medications;
DROP POLICY IF EXISTS "Allow all updates on medications" ON "public"."medications";

-- Drop new policies to ensure idempotency (re-runnability)
DROP POLICY IF EXISTS "Allow select caregiver_info for linked users" ON public.caregiver_info;
DROP POLICY IF EXISTS "Allow select caregiver_info for linked users" ON caregiver_info;
DROP POLICY IF EXISTS "Allow select caregiver_info for linked users" ON "public"."caregiver_info";
DROP POLICY IF EXISTS "Allow insert caregiver_info for own linkages" ON public.caregiver_info;
DROP POLICY IF EXISTS "Allow insert caregiver_info for own linkages" ON caregiver_info;
DROP POLICY IF EXISTS "Allow insert caregiver_info for own linkages" ON "public"."caregiver_info";
DROP POLICY IF EXISTS "Allow update caregiver_info for own linkages" ON public.caregiver_info;
DROP POLICY IF EXISTS "Allow update caregiver_info for own linkages" ON caregiver_info;
DROP POLICY IF EXISTS "Allow update caregiver_info for own linkages" ON "public"."caregiver_info";

-- Create least-privilege relationship checks matching the caller's Telegram chat ID
CREATE POLICY "Allow select caregiver_info for linked users" ON public.caregiver_info
  FOR SELECT TO authenticated
  USING (
    caregiver_chat_id = public.get_my_telegram_chat_id()
    OR
    patient_telegram_id = public.get_my_telegram_chat_id()
  );

CREATE POLICY "Allow insert caregiver_info for own linkages" ON public.caregiver_info
  FOR INSERT TO authenticated
  WITH CHECK (
    caregiver_chat_id = public.get_my_telegram_chat_id()
    OR
    patient_telegram_id = public.get_my_telegram_chat_id()
  );

CREATE POLICY "Allow update caregiver_info for own linkages" ON public.caregiver_info
  FOR UPDATE TO authenticated
  USING (
    caregiver_chat_id = public.get_my_telegram_chat_id()
    OR
    patient_telegram_id = public.get_my_telegram_chat_id()
  );


-- ==========================================
-- 4. chat_messages Table RLS Policies
-- ==========================================

-- Drop default user-only policies
DROP POLICY IF EXISTS "Users can view their own chat messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can view their own chat messages" ON chat_messages;
DROP POLICY IF EXISTS "Users can view their own chat messages" ON "public"."chat_messages";
DROP POLICY IF EXISTS "Users can insert their own chat messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can insert their own chat messages" ON chat_messages;
DROP POLICY IF EXISTS "Users can insert their own chat messages" ON "public"."chat_messages";

-- Drop new policies to ensure idempotency (re-runnability)
DROP POLICY IF EXISTS "Users can view chat messages if connection is accepted" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can view chat messages if connection is accepted" ON chat_messages;
DROP POLICY IF EXISTS "Users can view chat messages if connection is accepted" ON "public"."chat_messages";
DROP POLICY IF EXISTS "Users can insert chat messages if connection is accepted" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can insert chat messages if connection is accepted" ON chat_messages;
DROP POLICY IF EXISTS "Users can insert chat messages if connection is accepted" ON "public"."chat_messages";

-- Create connection-verified policies
CREATE POLICY "Users can view chat messages if connection is accepted" ON public.chat_messages
  FOR SELECT TO authenticated
  USING (
    (auth.uid() = sender_id OR auth.uid() = recipient_id)
    AND public.are_profiles_connected(sender_id, recipient_id)
  );

CREATE POLICY "Users can insert chat messages if connection is accepted" ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND public.are_profiles_connected(sender_id, recipient_id)
  );


-- ==========================================
-- 5. Diagnostic Helper: Get active policies
-- ==========================================
CREATE OR REPLACE FUNCTION public.get_policies_debug()
RETURNS TABLE (
  schemaname TEXT,
  tablename TEXT,
  policyname TEXT,
  permissive TEXT,
  roles TEXT[],
  cmd TEXT,
  qual TEXT,
  with_check TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.schemaname::TEXT,
    p.tablename::TEXT,
    p.policyname::TEXT,
    p.permissive::TEXT,
    p.roles::TEXT[],
    p.cmd::TEXT,
    p.qual::TEXT,
    p.with_check::TEXT
  FROM pg_policies p
  WHERE p.tablename IN ('profiles', 'caregiver_info', 'chat_messages', 'medications');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users for verification
REVOKE ALL ON FUNCTION public.get_policies_debug() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_policies_debug() TO authenticated;
