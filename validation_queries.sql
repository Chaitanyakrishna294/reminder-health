-- Re-MIND-eЯ Sprint 5.6A: Caregiver Relationship Architecture Foundation
-- Validation Queries: validation_queries.sql
-- Run these queries in your Supabase SQL Editor to verify the migration.

-- ==========================================
-- VALIDATION 1: Existing caregiver links migrated successfully
-- ==========================================
-- This query counts the total links in caregiver_info that have web profiles for both users,
-- and compares it with the number of records actually migrated to caregiver_connections.
-- The difference ('unmigrated_due_to_missing_profiles') represents Telegram-only links.
SELECT 
  (SELECT COUNT(*) FROM public.caregiver_info) AS total_legacy_records,
  (
    SELECT COUNT(*) 
    FROM public.caregiver_info ci
    JOIN public.profiles p_cg ON p_cg.telegram_chat_id = ci.caregiver_chat_id
    JOIN public.profiles p_pat ON p_pat.telegram_chat_id = ci.patient_telegram_id
  ) AS expected_migrated_records,
  (SELECT COUNT(*) FROM public.caregiver_connections) AS actual_migrated_records,
  (
    (SELECT COUNT(*) FROM public.caregiver_info) - 
    (SELECT COUNT(*) FROM public.caregiver_connections)
  ) AS unmigrated_due_to_missing_profiles;


-- ==========================================
-- VALIDATION 2: No duplicate caregiver/patient relationships exist
-- ==========================================
-- This query checks for any duplicate caregiver/patient pairs in caregiver_connections.
-- It should return 0 rows.
SELECT caregiver_profile_id, patient_profile_id, COUNT(*) AS duplicate_count
FROM public.caregiver_connections
GROUP BY caregiver_profile_id, patient_profile_id
HAVING COUNT(*) > 1;


-- ==========================================
-- VALIDATION 3: Only one active primary caregiver exists per patient
-- ==========================================
-- This query checks for any patient who has more than one active primary caregiver.
-- It should return 0 rows (enforced by index: idx_single_active_primary_caregiver).
SELECT patient_profile_id, COUNT(*) AS primary_caregiver_count
FROM public.caregiver_connections
WHERE is_primary = true AND is_active = true AND connection_status = 'ACCEPTED'
GROUP BY patient_profile_id
HAVING COUNT(*) > 1;


-- ==========================================
-- VALIDATION 4: Compatibility view returns both migrated & legacy records correctly
-- ==========================================
-- This query counts how many records are resolved via the junction table (is_migrated = true)
-- and how many remain legacy/Telegram-only (is_migrated = false).
SELECT 
  is_migrated, 
  COUNT(*) AS link_count,
  CASE 
    WHEN is_migrated = true THEN 'Migrated (Junction Table)' 
    ELSE 'Legacy (Telegram-Only)' 
  END AS record_source
FROM public.active_caregiver_links
GROUP BY is_migrated;

-- Distinct logical relationship test:
-- Compares distinct logical pairs across caregiver_info and caregiver_connections 
-- with distinct logical pairs exposed by the active_caregiver_links view.
WITH distinct_logical_pairs AS (
  SELECT caregiver_chat_id, patient_telegram_id 
  FROM public.caregiver_info
  UNION -- UNION automatically removes duplicates
  SELECT 
    p_cg.telegram_chat_id AS caregiver_chat_id,
    p_pat.telegram_chat_id AS patient_telegram_id
  FROM public.caregiver_connections cc
  JOIN public.profiles p_cg ON p_cg.id = cc.caregiver_profile_id
  JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id
  WHERE p_cg.telegram_chat_id IS NOT NULL AND p_pat.telegram_chat_id IS NOT NULL
)
SELECT 
  (SELECT COUNT(*) FROM distinct_logical_pairs) AS expected_logical_distinct_count,
  (SELECT COUNT(DISTINCT caregiver_chat_id || ':' || patient_telegram_id) FROM public.active_caregiver_links) AS actual_view_distinct_count,
  ((SELECT COUNT(*) FROM distinct_logical_pairs) = (SELECT COUNT(DISTINCT caregiver_chat_id || ':' || patient_telegram_id) FROM public.active_caregiver_links)) AS distinct_counts_match;


-- ==========================================
-- VALIDATION 5: Existing application queries continue functioning
-- ==========================================
-- 5a. Simulate legacy scheduler looking up caregivers for a patient's chat ID (e.g. '12345678')
-- This query uses the compatibility view and must execute without error.
SELECT caregiver_chat_id 
FROM public.active_caregiver_links
WHERE patient_telegram_id = '12345678' AND is_active = true AND connection_status = 'ACCEPTED';

-- 5b. Verify profiles still query role correctly (no changes to legacy auth role lookups)
SELECT id, role, is_patient, is_caregiver 
FROM public.profiles 
LIMIT 5;
