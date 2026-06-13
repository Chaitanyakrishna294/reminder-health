-- Re-MIND-eЯ: Care Circle Request Creation RPC and Profile SELECT RLS Update
-- Migration: migration_carecircle_rpc_and_profiles_rls.sql

BEGIN;

-- 1. Create SECURITY DEFINER RPC to request/invite caregiver connection
CREATE OR REPLACE FUNCTION public.invite_caregiver(caregiver_id UUID)
RETURNS UUID AS $$
DECLARE
  patient_id UUID;
  existing_id UUID;
  existing_status TEXT;
  existing_active BOOLEAN;
  new_conn_id UUID;
BEGIN
  patient_id := auth.uid();
  IF patient_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF patient_id = caregiver_id THEN
    RAISE EXCEPTION 'Cannot invite yourself';
  END IF;

  -- Verify caregiver exists and is a CAREGIVER
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = caregiver_id AND role = 'CAREGIVER'
  ) THEN
    RAISE EXCEPTION 'Invalid caregiver profile';
  END IF;

  -- Check for existing connection
  SELECT id, connection_status, is_active 
  INTO existing_id, existing_status, existing_active
  FROM public.caregiver_connections
  WHERE patient_profile_id = patient_id 
    AND caregiver_profile_id = caregiver_id;

  IF existing_id IS NOT NULL THEN
    IF existing_active = true AND existing_status = 'ACCEPTED' THEN
      RAISE EXCEPTION 'Already connected with this caregiver';
    ELSIF existing_active = true AND existing_status = 'PENDING' THEN
      RAISE EXCEPTION 'Connection request is already pending';
    ELSE
      -- Reactivate previously rejected/withdrawn/expired connection
      UPDATE public.caregiver_connections
      SET connection_status = 'PENDING',
          is_active = true,
          expires_at = now() + INTERVAL '30 days',
          updated_at = now()
      WHERE id = existing_id;
      RETURN existing_id;
    END IF;
  ELSE
    -- Insert new connection request
    INSERT INTO public.caregiver_connections (
      patient_profile_id,
      caregiver_profile_id,
      connection_status,
      is_active,
      expires_at
    ) VALUES (
      patient_id,
      caregiver_id,
      'PENDING',
      true,
      now() + INTERVAL '30 days'
    ) RETURNING id INTO new_conn_id;
    
    RETURN new_conn_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Restrict function execution to authenticated users
REVOKE ALL ON FUNCTION public.invite_caregiver(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invite_caregiver(UUID) TO authenticated;

-- 2. Update profiles SELECT RLS policy to read connected profiles via caregiver_connections
DROP POLICY IF EXISTS "Allow users to read their own profile" ON public.profiles;
CREATE POLICY "Allow users to read their own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    auth.uid() = id 
    OR 
    id IN (
      SELECT caregiver_profile_id 
      FROM public.caregiver_connections 
      WHERE patient_profile_id = auth.uid() AND is_active = true
      
      UNION
      
      SELECT patient_profile_id 
      FROM public.caregiver_connections 
      WHERE caregiver_profile_id = auth.uid() AND is_active = true
    )
  );

COMMIT;
