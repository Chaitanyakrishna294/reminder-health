-- RE-MIND-eЯ Medical Identity Card Migration (2026-06)
-- New medical_profiles table (1:1 with profiles), gated caregiver access,
-- can_view_medical_profile permission, and a private avatars bucket.
-- Idempotent — safe to re-run in the Supabase SQL Editor.
-- ============================================================================


-- ============================================================================
-- 1. medical_profiles table (1:1 with profiles.id)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.medical_profiles (
  user_id                       uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  date_of_birth                 date,
  gender                        text,
  blood_group                   text CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-','UNKNOWN')),
  height_cm                     numeric,
  weight_kg                     numeric,
  drug_allergies                text[] NOT NULL DEFAULT '{}',
  food_allergies                text[] NOT NULL DEFAULT '{}',
  other_allergies               text[] NOT NULL DEFAULT '{}',
  chronic_conditions            text[] NOT NULL DEFAULT '{}',
  emergency_contact_name        text,
  emergency_contact_phone       text,
  emergency_contact_relationship text,
  primary_language              text,
  preferred_reminder_language   text,
  timezone                      text,
  avatar_path                   text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

-- keep updated_at fresh
CREATE OR REPLACE FUNCTION public.set_medical_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_medical_profiles_updated_at ON public.medical_profiles;
CREATE TRIGGER trg_medical_profiles_updated_at
BEFORE UPDATE ON public.medical_profiles
FOR EACH ROW EXECUTE FUNCTION public.set_medical_profiles_updated_at();

-- New Care Circle permission flag (added before the RLS policy that references it).
ALTER TABLE public.caregiver_connections
  ADD COLUMN IF NOT EXISTS can_view_medical_profile boolean DEFAULT false;


-- ============================================================================
-- 2. RLS: owner full access; caregivers read-only when explicitly permitted
-- ============================================================================
ALTER TABLE public.medical_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner can read own medical profile" ON public.medical_profiles;
CREATE POLICY "Owner can read own medical profile" ON public.medical_profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Owner can insert own medical profile" ON public.medical_profiles;
CREATE POLICY "Owner can insert own medical profile" ON public.medical_profiles
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Owner can update own medical profile" ON public.medical_profiles;
CREATE POLICY "Owner can update own medical profile" ON public.medical_profiles
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Owner can delete own medical profile" ON public.medical_profiles;
CREATE POLICY "Owner can delete own medical profile" ON public.medical_profiles
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Caregivers may READ a patient's medical profile only with explicit permission.
DROP POLICY IF EXISTS "Caregivers can view permitted medical profile" ON public.medical_profiles;
CREATE POLICY "Caregivers can view permitted medical profile" ON public.medical_profiles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.caregiver_connections cc
      WHERE cc.patient_profile_id = medical_profiles.user_id
        AND cc.caregiver_profile_id = auth.uid()
        AND cc.connection_status = 'ACCEPTED'
        AND cc.is_active = true
        AND cc.can_view_medical_profile = true
    )
  );


-- ============================================================================
-- 3. Trigger guard: caregivers cannot flip the new permission flag
-- ============================================================================
-- Re-create the update-validation trigger so caregivers cannot flip the new flag.
CREATE OR REPLACE FUNCTION public.validate_caregiver_connection_updates()
RETURNS TRIGGER AS $$
DECLARE
  caller_uid UUID;
BEGIN
  caller_uid := auth.uid();
  IF caller_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.patient_profile_id != NEW.patient_profile_id OR OLD.caregiver_profile_id != NEW.caregiver_profile_id THEN
    RAISE EXCEPTION 'Forbidden: cannot modify connection profile associations';
  END IF;

  IF OLD.caregiver_profile_id = caller_uid THEN
    IF (OLD.connection_status = 'PENDING' AND NEW.connection_status = 'WITHDRAWN') OR
       (OLD.connection_status = 'ACCEPTED' AND NEW.connection_status = 'REJECTED') THEN
      IF OLD.is_primary IS DISTINCT FROM NEW.is_primary OR
         OLD.can_view_medications IS DISTINCT FROM NEW.can_view_medications OR
         OLD.can_view_vault IS DISTINCT FROM NEW.can_view_vault OR
         OLD.can_view_reports IS DISTINCT FROM NEW.can_view_reports OR
         OLD.can_edit_medications IS DISTINCT FROM NEW.can_edit_medications OR
         OLD.can_receive_escalations IS DISTINCT FROM NEW.can_receive_escalations OR
         OLD.can_view_medical_profile IS DISTINCT FROM NEW.can_view_medical_profile OR
         OLD.relationship_type IS DISTINCT FROM NEW.relationship_type THEN
        RAISE EXCEPTION 'Forbidden: caregiver cannot modify permissions or relationship metadata';
      END IF;
    ELSE
      RAISE EXCEPTION 'Forbidden: caregiver is only authorized to withdraw a request or disconnect';
    END IF;
  ELSIF OLD.patient_profile_id = caller_uid THEN
    NULL;
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
-- 4. Private avatars storage bucket + owner policies
-- ----------------------------------------------------------------------------
-- Path convention: {user_id}/avatar.<ext>. Owners manage their own folder.
-- Caregiver avatar reads are minted server-side via the service client after a
-- can_view_medical_profile check, so no caregiver storage policy is needed.
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Avatar owner read" ON storage.objects;
CREATE POLICY "Avatar owner read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Avatar owner insert" ON storage.objects;
CREATE POLICY "Avatar owner insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Avatar owner update" ON storage.objects;
CREATE POLICY "Avatar owner update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Avatar owner delete" ON storage.objects;
CREATE POLICY "Avatar owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);


-- ============================================================================
-- 5. Surface can_view_medical_profile through active_caregiver_links
-- ----------------------------------------------------------------------------
-- The manage UI reads connections from this view. Append the new flag as the
-- last column (CREATE OR REPLACE VIEW only allows appending). Legacy
-- caregiver_info rows default to false. Preserves security_invoker=on.
-- ============================================================================
CREATE OR REPLACE VIEW public.active_caregiver_links
WITH (security_invoker = on) AS
 SELECT cc.id::text AS connection_id,
    p_cg.telegram_chat_id AS caregiver_chat_id,
    p_cg.full_name AS caregiver_name,
    p_pat.telegram_chat_id AS patient_telegram_id,
    cc.connection_status,
    cc.is_active,
    cc.created_at,
    cc.relationship_type,
    cc.is_primary,
    cc.can_view_medications,
    cc.can_view_vault,
    cc.can_view_reports,
    cc.can_edit_medications,
    cc.can_receive_escalations,
    true AS is_migrated,
    cc.can_view_medical_profile
   FROM caregiver_connections cc
     JOIN profiles p_cg ON p_cg.id = cc.caregiver_profile_id
     JOIN profiles p_pat ON p_pat.id = cc.patient_profile_id
UNION ALL
 SELECT ci.id::text AS connection_id,
    ci.caregiver_chat_id,
    ci.caregiver_name,
    ci.patient_telegram_id,
    ci.connection_status,
    ci.is_active,
    ci.created_at,
    'OTHER'::text AS relationship_type,
    false AS is_primary,
    true AS can_view_medications,
    false AS can_view_vault,
    false AS can_view_reports,
    false AS can_edit_medications,
    true AS can_receive_escalations,
    false AS is_migrated,
    false AS can_view_medical_profile
   FROM caregiver_info ci
  WHERE NOT (EXISTS ( SELECT 1
           FROM caregiver_connections cc
             JOIN profiles p_cg ON p_cg.id = cc.caregiver_profile_id AND p_cg.telegram_chat_id = ci.caregiver_chat_id
             JOIN profiles p_pat ON p_pat.id = cc.patient_profile_id AND p_pat.telegram_chat_id = ci.patient_telegram_id));
