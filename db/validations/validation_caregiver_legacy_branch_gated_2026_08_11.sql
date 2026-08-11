-- Validation for migration_caregiver_legacy_branch_gated_2026_08_11.sql
-- READ-ONLY. Run in the Supabase SQL editor AFTER applying. Every row should read DONE.
-- One UNION ALL result set on purpose — the editor shows only the last statement's result.

SELECT * FROM (

-- 1-3. The legacy branch is gone from each of the three policies, and the correct flag survives.
--      Both halves matter: absence of caregiver_info proves the bypass is closed, presence of the
--      flag proves we did not accidentally replace it with something MORE permissive.
SELECT 1 AS n,
  CASE
    WHEN qual NOT LIKE '%caregiver_info%' AND qual LIKE '%can_view_medications%'
    THEN 'DONE  1. medications policy: legacy branch removed, can_view_medications still enforced'
    ELSE 'FAIL  1. medications policy: ' || COALESCE(qual, '(missing)')
  END AS result
FROM pg_policies
WHERE schemaname='public' AND tablename='medications'
  AND policyname='Caregivers can view patient medications'

UNION ALL

SELECT 2,
  CASE
    WHEN qual NOT LIKE '%caregiver_info%' AND qual LIKE '%can_view_medications%'
    THEN 'DONE  2. reminder_events policy: legacy branch removed, can_view_medications still enforced'
    ELSE 'FAIL  2. reminder_events policy: ' || COALESCE(qual, '(missing)')
  END
FROM pg_policies
WHERE schemaname='public' AND tablename='reminder_events'
  AND policyname='Caregivers view patient events'

UNION ALL

SELECT 3,
  CASE
    WHEN qual NOT LIKE '%caregiver_info%' AND qual LIKE '%can_view_reports%'
    THEN 'DONE  3. reminder_logs policy: legacy branch removed, can_view_reports still enforced'
    ELSE 'FAIL  3. reminder_logs policy: ' || COALESCE(qual, '(missing)')
  END
FROM pg_policies
WHERE schemaname='public' AND tablename='reminder_logs'
  AND policyname='Caregivers view patient logs'

UNION ALL

-- 4. The policies still EXIST. A DROP that succeeded followed by a CREATE that silently did not
--    would leave caregivers with no access at all — the failure mode this migration exists to
--    avoid, arrived at from the other direction.
SELECT 4,
  CASE
    WHEN COUNT(*) = 3
    THEN 'DONE  4. all three caregiver SELECT policies present'
    ELSE 'FAIL  4. expected 3 caregiver policies, found ' || COUNT(*)
  END
FROM pg_policies
WHERE schemaname='public'
  AND (tablename, policyname) IN (
    ('medications',     'Caregivers can view patient medications'),
    ('reminder_events', 'Caregivers view patient events'),
    ('reminder_logs',   'Caregivers view patient logs')
  )

UNION ALL

-- 5. Patient self-read must be untouched. This migration narrows CAREGIVER access only; if a
--    patient ever lost sight of their own doses that would be far worse than the bug being fixed.
SELECT 5,
  CASE
    WHEN COUNT(*) >= 2
    THEN 'DONE  5. patient self-read policies intact on reminder_events and reminder_logs'
    ELSE 'FAIL  5. expected both self-read policies, found ' || COUNT(*)
  END
FROM pg_policies
WHERE schemaname='public'
  AND policyname IN ('Users view own events', 'Users view own logs')

UNION ALL

-- 6. No caregiver policy anywhere still reads caregiver_info without a can_* gate. This is the
--    original audit's Q5 re-run: it catches any OTHER policy that has the same shape, including
--    one added later.
SELECT 6,
  CASE
    WHEN COUNT(*) = 0
    THEN 'DONE  6. no policy reads caregiver_info without a can_* gate'
    ELSE 'FAIL  6. still ungated: ' || string_agg(tablename || '.' || policyname, ', ')
  END
FROM pg_policies
WHERE schemaname='public'
  AND COALESCE(qual,'') LIKE '%caregiver_info%'
  AND COALESCE(qual,'') NOT LIKE '%can_%'

UNION ALL

-- 7. Real-data effect: with the legacy branch gone, does every previously-granted relationship
--    still resolve through caregiver_connections? Should be 0 — and if the migration's own
--    pre-flight guard did its job this cannot be anything else, so a non-zero here means
--    something changed between applying and validating.
SELECT 7,
  CASE
    WHEN COUNT(*) = 0
    THEN 'DONE  7. every legacy relationship still granted via caregiver_connections (nobody lost access)'
    ELSE 'FAIL  7. ' || COUNT(*) || ' legacy relationship(s) now have NO access — investigate immediately'
  END
FROM public.caregiver_info ci
WHERE ci.is_active = true AND ci.connection_status = 'ACCEPTED'
  -- Same NULL exclusion the migration's pre-flight guard uses, and for the same reason: a legacy
  -- row with either id NULL never granted anything (the branch's join to profiles cannot match a
  -- NULL, and a NULL patient id contributes only NULL to an IN (...) list), so it cannot have lost
  -- anything either. Without this, live rows 4 and 24 — abandoned half-written invitations —
  -- reported as "2 relationships now have NO access", which was alarming and wrong.
  AND ci.caregiver_chat_id IS NOT NULL
  AND ci.patient_telegram_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.caregiver_connections cc
    JOIN public.profiles p_cg  ON p_cg.id  = cc.caregiver_profile_id
    JOIN public.profiles p_pat ON p_pat.id = cc.patient_profile_id
    WHERE p_cg.telegram_chat_id  = ci.caregiver_chat_id
      AND p_pat.telegram_chat_id = ci.patient_telegram_id
      AND cc.is_active = true
      AND cc.connection_status = 'ACCEPTED'
      AND cc.can_view_medications = true
  )

) checks
ORDER BY n;
