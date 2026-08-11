-- Diagnostic: the 2 accepted legacy caregiver_info rows that aborted
-- migration_caregiver_legacy_branch_gated_2026_08_11.sql on its first apply attempt.
-- 100% READ-ONLY. Safe on production.
--
-- The guard reported "2 relationship(s) would LOSE access. Pairs: <NULL>". string_agg returns
-- NULL only when every input is NULL, and 'x' || NULL is NULL — so at least one id column is NULL
-- in both rows. This shows exactly which, and confirms they grant nobody anything.

SELECT
  ci.id,
  COALESCE(ci.caregiver_chat_id,  '(NULL)') AS caregiver_chat_id,
  COALESCE(ci.patient_telegram_id,'(NULL)') AS patient_telegram_id,
  ci.connection_status,
  ci.is_active,
  -- Can this row grant anything through the legacy RLS branch as it stands today?
  CASE
    WHEN ci.caregiver_chat_id IS NULL
      THEN 'GRANTS NOTHING — no caregiver id, so the branch''s join to profiles can never match'
    WHEN ci.patient_telegram_id IS NULL
      THEN 'GRANTS NOTHING — no patient id, so it contributes only NULL to the IN (...) list'
    WHEN NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.telegram_chat_id = ci.caregiver_chat_id)
      THEN 'GRANTS NOTHING — no profile has this caregiver_chat_id, so nobody can authenticate as it'
    ELSE 'LIVE — this row really does grant access'
  END AS effect_today,
  -- And is there a modern connection behind it?
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.caregiver_connections cc
      JOIN public.profiles p_cg  ON p_cg.id  = cc.caregiver_profile_id
      JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id
      WHERE p_cg.telegram_chat_id  = ci.caregiver_chat_id
        AND p_pat.telegram_chat_id = ci.patient_telegram_id
        AND cc.is_active = true
        AND cc.connection_status = 'ACCEPTED'
    ) THEN 'yes'
    ELSE 'no'
  END AS has_modern_connection
FROM public.caregiver_info ci
WHERE ci.is_active = true
  AND ci.connection_status = 'ACCEPTED'
ORDER BY ci.id;
