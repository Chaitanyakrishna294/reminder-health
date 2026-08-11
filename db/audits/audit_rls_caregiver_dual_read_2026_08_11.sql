-- M3 RLS AUDIT — the legacy caregiver_info dual-read branch
-- db/audits/audit_rls_caregiver_dual_read_2026_08_11.sql
--
-- 100% READ-ONLY. No writes, no DDL, no transaction needed. Safe to run on production.
-- Returns ONE result set (the Supabase SQL editor only displays the last statement's result,
-- which is how a broken migration got a clean bill of health on 2026-08-11 — see
-- validation_snooze_ambiguous_column_2026_08_11.sql).
--
-- WHAT THIS IS ABOUT. Caregiver read policies are written as:
--
--     -- upgraded path, gated on a permission flag
--     SELECT ... FROM caregiver_connections cc WHERE ... AND cc.can_view_reports = true
--     UNION
--     -- legacy path, gated on NOTHING but ACCEPTED + is_active
--     SELECT ... FROM caregiver_info ci WHERE ci.is_active AND ci.connection_status = 'ACCEPTED'
--
-- A UNION grants if EITHER branch matches. So any caregiver holding an accepted legacy
-- caregiver_info row reads the patient's data regardless of the can_* flags — i.e. the patient's
-- permission toggles are a NO-OP for that caregiver. CLAUDE.md flags this as must-resolve before
-- any Android caregiver feature ships.
--
-- WHY AUDIT BEFORE FIXING. WORK_LEDGER calls caregiver_info "still load-bearing". Dropping the
-- legacy branch outright would silently cut off every caregiver who has ONLY a legacy row — the
-- opposite failure, and worse for a care-circle product. The numbers below decide which fix is
-- correct:
--
--   Q2 = 0  -> nobody depends on the legacy path; it can simply be dropped.
--   Q3 = 0  -> the legacy path currently over-grants to nobody; gating it is a safe no-op today
--              and closes the hole permanently.
--   Q3 > 0  -> there are LIVE over-grants right now. Each row is a patient whose explicit "no"
--              is being ignored. Fix and backfill, do not just document.

SELECT * FROM (

-- Q1. How much legacy data is actually live?
SELECT 1 AS q, 'Q1  legacy caregiver_info rows that currently grant access (ACCEPTED + active)' AS question,
       COUNT(*)::text AS answer
FROM public.caregiver_info ci
WHERE ci.is_active = true AND ci.connection_status = 'ACCEPTED'

UNION ALL

-- Q2. Legacy-only relationships: these are the ones that would LOSE access if the legacy branch
--     were removed. If this is 0, removal is safe outright.
SELECT 2, 'Q2  ...of those, how many have NO modern caregiver_connections row (would lose access if legacy branch dropped)',
       COUNT(*)::text
FROM public.caregiver_info ci
JOIN public.profiles p_cg ON p_cg.telegram_chat_id = ci.caregiver_chat_id
JOIN public.profiles p_pat ON p_pat.telegram_chat_id = ci.patient_telegram_id
WHERE ci.is_active = true AND ci.connection_status = 'ACCEPTED'
  AND NOT EXISTS (
    SELECT 1 FROM public.caregiver_connections cc
    WHERE cc.caregiver_profile_id = p_cg.id
      AND cc.patient_profile_id  = p_pat.id
      AND cc.is_active = true
      AND cc.connection_status = 'ACCEPTED'
  )

UNION ALL

-- Q3. THE ACTUAL SECURITY FINDING. A modern row exists and says "no reports", but the legacy
--     branch grants dose-history access anyway. Every row here is a patient whose explicit
--     denial is being overridden right now.
SELECT 3, 'Q3  *** LIVE OVER-GRANTS: legacy row grants reports access the patient set can_view_reports=false ***',
       COUNT(*)::text
FROM public.caregiver_info ci
JOIN public.profiles p_cg ON p_cg.telegram_chat_id = ci.caregiver_chat_id
JOIN public.profiles p_pat ON p_pat.telegram_chat_id = ci.patient_telegram_id
JOIN public.caregiver_connections cc
  ON cc.caregiver_profile_id = p_cg.id AND cc.patient_profile_id = p_pat.id
WHERE ci.is_active = true AND ci.connection_status = 'ACCEPTED'
  AND cc.can_view_reports IS DISTINCT FROM true

UNION ALL

-- Q4. Same question for the medications/events permission.
SELECT 4, 'Q4  *** LIVE OVER-GRANTS: legacy row grants access the patient set can_view_medications=false ***',
       COUNT(*)::text
FROM public.caregiver_info ci
JOIN public.profiles p_cg ON p_cg.telegram_chat_id = ci.caregiver_chat_id
JOIN public.profiles p_pat ON p_pat.telegram_chat_id = ci.patient_telegram_id
JOIN public.caregiver_connections cc
  ON cc.caregiver_profile_id = p_cg.id AND cc.patient_profile_id = p_pat.id
WHERE ci.is_active = true AND ci.connection_status = 'ACCEPTED'
  AND cc.can_view_medications IS DISTINCT FROM true

UNION ALL

-- Q5. Every RLS policy whose expression reads caregiver_info WITHOUT any can_* gate. This is the
--     blast radius: each one is a table where the legacy branch bypasses permissions.
SELECT 5, 'Q5  policies reading caregiver_info with NO can_* gate: ' || tablename || '.' || policyname,
       'cmd=' || cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND COALESCE(qual, '') LIKE '%caregiver_info%'
  AND COALESCE(qual, '') NOT LIKE '%can_%'

UNION ALL

-- Q6. Policies that read caregiver_info AND mention a can_* flag. Listed separately because a
--     UNION'd policy can mention can_* in one branch and still be ungated in the legacy branch —
--     these need reading by eye, they are NOT automatically safe.
SELECT 6, 'Q6  policies reading caregiver_info that DO mention can_* (verify the legacy branch by eye): '
          || tablename || '.' || policyname,
       'cmd=' || cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND COALESCE(qual, '') LIKE '%caregiver_info%'
  AND COALESCE(qual, '') LIKE '%can_%'

UNION ALL

-- Q7. Tables holding patient data with RLS switched OFF entirely. Should be empty.
SELECT 7, 'Q7  *** public tables with RLS DISABLED: ' || c.relname || ' ***', 'rowsecurity=false'
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false

UNION ALL

-- Q8. RLS on but zero policies. Intentional for service-role-only tables (link_codes,
--     scheduler_locks, rate_limits...) — listed so the intent is re-confirmed, not assumed.
SELECT 8, 'Q8  RLS on, zero policies (service-role only — confirm each is intentional): ' || c.relname, ''
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
  AND NOT EXISTS (SELECT 1 FROM pg_policies pp WHERE pp.schemaname='public' AND pp.tablename=c.relname)

UNION ALL

-- Q9. Anything the anon role can still read directly. The Android app ships the anon key, so
--     anon's reach IS the app's worst case if a token is ever absent or forged.
SELECT 9, 'Q9  *** tables with a policy granting the anon role: ' || tablename || '.' || policyname || ' ***',
       'cmd=' || cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND 'anon' = ANY(roles)

UNION ALL

-- Q10. FORCE RLS on the two PHI tables. Without it, a table owner (and anything running as the
--      owner) bypasses RLS entirely — applied 2026-08-08 as APPLIED.md #53; re-confirmed here
--      because it is invisible in normal use and catastrophic if it ever regresses.
SELECT 10, 'Q10 FORCE RLS on ' || c.relname,
       CASE WHEN c.relforcerowsecurity THEN 'DONE forced' ELSE '*** FAIL not forced ***' END
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('reminder_logs', 'reminder_events')

) audit
ORDER BY q, question;
