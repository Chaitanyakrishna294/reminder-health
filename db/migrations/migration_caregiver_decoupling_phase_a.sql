-- Re-MIND-eЯ Sprint 5.6A: Caregiver Relationship Architecture Foundation
-- Migration Script: migration_caregiver_decoupling_phase_a.sql
-- Run this in your Supabase SQL Editor.

BEGIN;

-- 1. Dual Role Preparation (Add fields to profiles, do NOT remove legacy columns/constraints)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_patient BOOLEAN DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_caregiver BOOLEAN DEFAULT false;

-- Backfill profile flags based on current legacy role values
UPDATE public.profiles 
SET 
  is_patient = (role = 'PATIENT'),
  is_caregiver = (role = 'CAREGIVER');


-- 2. Create caregiver_connections Junction Table
CREATE TABLE IF NOT EXISTS public.caregiver_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caregiver_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  patient_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  connection_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (connection_status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_caregiver_patient_connection UNIQUE (caregiver_profile_id, patient_profile_id),
  CONSTRAINT no_self_care CHECK (caregiver_profile_id <> patient_profile_id)
);


-- 3. Add Relationship Metadata
ALTER TABLE public.caregiver_connections 
ADD COLUMN IF NOT EXISTS relationship_type TEXT DEFAULT 'OTHER' 
  CHECK (relationship_type IN ('SON', 'DAUGHTER', 'SPOUSE', 'PARENT', 'SIBLING', 'FRIEND', 'DOCTOR', 'OTHER')),
ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT false;

-- Enforce single active primary caregiver per patient connection
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_active_primary_caregiver 
ON public.caregiver_connections (patient_profile_id) 
WHERE is_primary = true AND is_active = true AND connection_status = 'ACCEPTED';


-- 4. Add Permission Flags
ALTER TABLE public.caregiver_connections 
ADD COLUMN IF NOT EXISTS can_view_medications BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS can_view_vault BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS can_view_reports BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS can_edit_medications BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS can_receive_escalations BOOLEAN DEFAULT true;


-- 5. Add Performance & Lookup Indexes
CREATE INDEX IF NOT EXISTS idx_cg_connections_caregiver
ON public.caregiver_connections(caregiver_profile_id);

CREATE INDEX IF NOT EXISTS idx_cg_connections_patient
ON public.caregiver_connections(patient_profile_id);

CREATE INDEX IF NOT EXISTS idx_cg_connections_active
ON public.caregiver_connections(patient_profile_id, caregiver_profile_id)
WHERE is_active = true;


-- 6. Add updated_at Automation Trigger
CREATE OR REPLACE FUNCTION public.update_caregiver_connection_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_caregiver_connections_updated_at
BEFORE UPDATE ON public.caregiver_connections
FOR EACH ROW
EXECUTE FUNCTION public.update_caregiver_connection_updated_at();


-- 7. Create active_caregiver_links Read Compatibility View (Exposing all metadata and permission flags)
CREATE OR REPLACE VIEW public.active_caregiver_links AS
-- 7a. Migrated connections resolved to chat IDs with all metadata and permissions
SELECT 
  cc.id::text AS connection_id,
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
  true AS is_migrated
FROM public.caregiver_connections cc
JOIN public.profiles p_cg ON p_cg.id = cc.caregiver_profile_id
JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id

UNION ALL

-- 7b. Legacy/Telegram-only connections not yet promoted (with defaults populated)
SELECT 
  ci.id::text AS connection_id,
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
  false AS is_migrated
FROM public.caregiver_info ci
WHERE NOT EXISTS (
  SELECT 1 
  FROM public.caregiver_connections cc
  JOIN public.profiles p_cg ON p_cg.id = cc.caregiver_profile_id AND p_cg.telegram_chat_id = ci.caregiver_chat_id
  JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id AND p_pat.telegram_chat_id = ci.patient_telegram_id
);


-- 8. Backfill Data from caregiver_info to caregiver_connections
INSERT INTO public.caregiver_connections (
  caregiver_profile_id, 
  patient_profile_id, 
  connection_status, 
  is_active, 
  created_at
)
SELECT 
  p_cg.id AS caregiver_profile_id, 
  p_pat.id AS patient_profile_id,
  ci.connection_status,
  ci.is_active,
  ci.created_at
FROM public.caregiver_info ci
JOIN public.profiles p_cg ON p_cg.telegram_chat_id = ci.caregiver_chat_id
JOIN public.profiles p_pat ON p_pat.telegram_chat_id = ci.patient_telegram_id
ON CONFLICT (caregiver_profile_id, patient_profile_id) DO NOTHING;

COMMIT;
