-- RE-MIND-eЯ: Care Circle universal connect + accept-regression fix (2026-06)
-- Idempotent — safe to re-run in the Supabase SQL Editor.
-- ============================================================================

-- ============================================================================
-- 1. P0 FIX: restore caregiver ACCEPT in the connection-update validation trigger.
-- ----------------------------------------------------------------------------
-- A prior migration overwrote this with a version lacking the PENDING->ACCEPTED
-- branch, blocking every caregiver accept. Restore the correct logic (ACCEPT +
-- decline/disconnect branches + the app.cc_internal bypass) and keep the new
-- can_view_medical_profile guard.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.validate_caregiver_connection_updates()
RETURNS TRIGGER AS $$
DECLARE
  caller_uid UUID;
BEGIN
  caller_uid := auth.uid();

  -- System/service-role context, or an internal trigger-driven update, bypasses validation.
  IF caller_uid IS NULL OR current_setting('app.cc_internal', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF OLD.patient_profile_id != NEW.patient_profile_id
     OR OLD.caregiver_profile_id != NEW.caregiver_profile_id THEN
    RAISE EXCEPTION 'Forbidden: cannot modify connection profile associations';
  END IF;

  IF OLD.caregiver_profile_id = caller_uid THEN
    -- Caregiver accepting a pending request.
    IF OLD.connection_status = 'PENDING' AND NEW.connection_status = 'ACCEPTED' THEN
      IF OLD.can_view_medications IS DISTINCT FROM NEW.can_view_medications
         OR OLD.can_view_vault IS DISTINCT FROM NEW.can_view_vault
         OR OLD.can_view_reports IS DISTINCT FROM NEW.can_view_reports
         OR OLD.can_edit_medications IS DISTINCT FROM NEW.can_edit_medications
         OR OLD.can_receive_escalations IS DISTINCT FROM NEW.can_receive_escalations
         OR OLD.can_view_medical_profile IS DISTINCT FROM NEW.can_view_medical_profile
         OR OLD.relationship_type IS DISTINCT FROM NEW.relationship_type THEN
        RAISE EXCEPTION 'Forbidden: caregiver cannot modify permissions or relationship metadata';
      END IF;

    -- Caregiver declining a pending request or disconnecting an accepted one.
    ELSIF (OLD.connection_status = 'PENDING' AND NEW.connection_status IN ('REJECTED', 'WITHDRAWN'))
       OR (OLD.connection_status = 'ACCEPTED' AND NEW.connection_status = 'REJECTED') THEN
      IF OLD.is_primary IS DISTINCT FROM NEW.is_primary
         OR OLD.can_view_medications IS DISTINCT FROM NEW.can_view_medications
         OR OLD.can_view_vault IS DISTINCT FROM NEW.can_view_vault
         OR OLD.can_view_reports IS DISTINCT FROM NEW.can_view_reports
         OR OLD.can_edit_medications IS DISTINCT FROM NEW.can_edit_medications
         OR OLD.can_receive_escalations IS DISTINCT FROM NEW.can_receive_escalations
         OR OLD.can_view_medical_profile IS DISTINCT FROM NEW.can_view_medical_profile
         OR OLD.relationship_type IS DISTINCT FROM NEW.relationship_type THEN
        RAISE EXCEPTION 'Forbidden: caregiver cannot modify permissions or relationship metadata';
      END IF;

    ELSE
      RAISE EXCEPTION 'Forbidden: caregiver is only authorized to accept, decline, or disconnect';
    END IF;

  ELSIF OLD.patient_profile_id = caller_uid THEN
    NULL; -- patient owns the connection
  ELSE
    RAISE EXCEPTION 'Forbidden: you are not authorized to update this care connection';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_caregiver_connections ON public.caregiver_connections;
CREATE TRIGGER trg_validate_caregiver_connections
BEFORE UPDATE ON public.caregiver_connections
FOR EACH ROW EXECUTE FUNCTION public.validate_caregiver_connection_updates();


-- ============================================================================
-- 2. Universal Connect Code on every profile (works for web-only accounts too).
-- ============================================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS connect_code text UNIQUE;

-- Generate a unique, human-friendly code: RM + 6 unambiguous chars.
CREATE OR REPLACE FUNCTION public.gen_connect_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code  text;
  v_i     int;
  v_ok    boolean := false;
BEGIN
  WHILE NOT v_ok LOOP
    v_code := 'RM';
    FOR v_i IN 1..6 LOOP
      v_code := v_code || substr(v_chars, floor(random() * length(v_chars))::int + 1, 1);
    END LOOP;
    v_ok := NOT EXISTS (SELECT 1 FROM public.profiles WHERE connect_code = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

-- Backfill existing profiles.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.profiles WHERE connect_code IS NULL LOOP
    UPDATE public.profiles SET connect_code = public.gen_connect_code() WHERE id = r.id;
  END LOOP;
END $$;

-- Assign on new-user creation (Telegram trigger path).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name, telegram_chat_id, connect_code)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'role', 'PATIENT'),
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'User'),
    'WEB-' || NEW.id::text,
    public.gen_connect_code()
  );
  RETURN NEW;
END;
$$;

-- Assign on self-heal profile creation (web path).
CREATE OR REPLACE FUNCTION public.ensure_my_profile()
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid  UUID := auth.uid();
  prof public.profiles%ROWTYPE;
  meta JSONB;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO prof FROM public.profiles WHERE id = uid;
  IF FOUND THEN
    -- Heal a missing connect_code on existing rows.
    IF prof.connect_code IS NULL THEN
      UPDATE public.profiles SET connect_code = public.gen_connect_code() WHERE id = uid
      RETURNING * INTO prof;
    END IF;
    RETURN prof;
  END IF;

  SELECT raw_user_meta_data INTO meta FROM auth.users WHERE id = uid;

  INSERT INTO public.profiles (id, role, full_name, telegram_chat_id, connect_code)
  VALUES (
    uid,
    COALESCE(meta->>'role', 'PATIENT'),
    COALESCE(meta->>'full_name', 'User'),
    'WEB-' || uid::text,
    public.gen_connect_code()
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO prof FROM public.profiles WHERE id = uid;
  RETURN prof;
END;
$$;

-- Resolve ANY active account by its connect code (web-only included).
CREATE OR REPLACE FUNCTION public.lookup_profile_by_connect_code(p_code text)
RETURNS TABLE (profile_id uuid, full_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, COALESCE(p.full_name, 'User')
  FROM public.profiles p
  WHERE p.connect_code = upper(trim(p_code))
  LIMIT 1;
END;
$$;
REVOKE ALL ON FUNCTION public.lookup_profile_by_connect_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_profile_by_connect_code(text) TO authenticated;


-- ============================================================================
-- 3. Relax invite_caregiver: any existing profile can be invited (not just
--    Telegram-registered caregivers), so web-only accounts connect.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.invite_caregiver(caregiver_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_variable
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

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = caregiver_id) THEN
    RAISE EXCEPTION 'Invalid profile';
  END IF;

  SELECT id, connection_status, is_active
  INTO existing_id, existing_status, existing_active
  FROM public.caregiver_connections
  WHERE patient_profile_id = patient_id AND caregiver_profile_id = caregiver_id;

  IF existing_id IS NOT NULL THEN
    IF existing_active = true AND existing_status = 'ACCEPTED' THEN
      RAISE EXCEPTION 'Already connected with this person';
    ELSIF existing_active = true AND existing_status = 'PENDING' THEN
      RAISE EXCEPTION 'Connection request is already pending';
    ELSE
      UPDATE public.caregiver_connections
      SET connection_status = 'PENDING', is_active = true,
          expires_at = now() + INTERVAL '30 days', updated_at = now()
      WHERE id = existing_id;
      RETURN existing_id;
    END IF;
  ELSE
    INSERT INTO public.caregiver_connections (
      patient_profile_id, caregiver_profile_id, connection_status, is_active, expires_at
    ) VALUES (
      patient_id, caregiver_id, 'PENDING', true, now() + INTERVAL '30 days'
    ) RETURNING id INTO new_conn_id;
    RETURN new_conn_id;
  END IF;
END;
$function$;


-- ============================================================================
-- 4. Profile-photo sharing toggle for caregivers (default: shared).
-- ============================================================================
ALTER TABLE public.medical_profiles
  ADD COLUMN IF NOT EXISTS share_photo_with_caregivers boolean NOT NULL DEFAULT true;
