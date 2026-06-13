-- Re-MIND-eЯ Sprint 5.6A: Caregiver Relationship Architecture Foundation
-- Rollback Script: rollback_caregiver_decoupling_phase_a.sql
-- Run this in your Supabase SQL Editor to undo Phase A changes.

BEGIN;

-- 1. Drop Read Compatibility View
DROP VIEW IF EXISTS public.active_caregiver_links;

-- 2. Drop updated_at automation trigger & function
DROP TRIGGER IF EXISTS trg_caregiver_connections_updated_at ON public.caregiver_connections;
DROP FUNCTION IF EXISTS public.update_caregiver_connection_updated_at();

-- 3. Drop Junction Table (automatically drops indexes, constraints, metadata, and flags on this table)
DROP TABLE IF EXISTS public.caregiver_connections CASCADE;

-- 4. Remove columns from profiles table
ALTER TABLE public.profiles 
DROP COLUMN IF EXISTS is_patient,
DROP COLUMN IF EXISTS is_caregiver;

COMMIT;
