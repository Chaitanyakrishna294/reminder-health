-- Validation queries for migration_security_lockdown_2026_07_29.sql
-- Paste each block into the Supabase SQL editor AFTER applying the migration.
-- Expected results are stated in the comment above each query.

-- ============================================================================
-- A1. The four scheduler RPCs must not be executable by anon/authenticated.
-- EXPECT: exactly 4 rows; anon_exec = f, authenticated_exec = f,
--         service_role_exec = t on every row.
-- (has_function_privilege also reflects grants held via PUBLIC, so `f` here
--  proves the PUBLIC grant is gone — the actual bug being fixed.)
-- ============================================================================
SELECT p.oid::regprocedure                                    AS function,
       has_function_privilege('anon', p.oid, 'EXECUTE')           AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE')  AS authenticated_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE')   AS service_role_exec
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('try_acquire_scheduler_lock', 'release_scheduler_lock',
                    'close_daily_medications', 'scan_and_escalate_overdue_reminders')
ORDER BY 1;

-- ============================================================================
-- A2. Full sweep of all public functions (review anything unexpected = true;
--     the client-callable RPC list in docs/WORK_LEDGER.md §5 SHOULD be true
--     for authenticated: invite_caregiver, respond_to_caregiver_request,
--     lookup_profile_by_connect_code, lookup_caregiver_by_code,
--     ensure_my_profile, resolve_reminder_event, correct_reminder_event,
--     redeem_link_code, delete_my_account, search_medication_catalog,
--     check_rate_limit, get_my_telegram_chat_id, are_profiles_connected,
--     get_policies_debug).
-- ============================================================================
SELECT p.oid::regprocedure,
       has_function_privilege('anon', p.oid, 'EXECUTE'),
       has_function_privilege('authenticated', p.oid, 'EXECUTE')
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY 1;

-- ============================================================================
-- B1. caregiver_info policies.
-- EXPECT: exactly 3 rows —
--   "Allow select caregiver_info for linked users"  | SELECT | with_check NULL
--   "Allow insert caregiver_info for own linkages"  | INSERT | with_check contains
--        "patient_telegram_id IS NULL" ANDed (no OR patient-side arm)
--   "Allow update caregiver_info for own linkages"  | UPDATE | with_check present
--        and containing an "(patient_telegram_id IS NULL)" arm
-- ============================================================================
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'caregiver_info'
ORDER BY policyname;

-- ============================================================================
-- B2. Guard trigger installed on caregiver_info.
-- EXPECT: 1 row, tgenabled = 'O' (enabled).
-- ============================================================================
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgrelid = 'public.caregiver_info'::regclass
  AND tgname = 'trg_guard_caregiver_info_client_writes';

-- ============================================================================
-- C1. caregiver_connections must have NO INSERT policy (requests are created
--     only via the invite_caregiver SECURITY DEFINER RPC).
-- EXPECT: rows for SELECT ("Users can view own connections") and UPDATE
--         ("Users can update own connections") only — zero rows with
--         cmd = 'INSERT'.
-- ============================================================================
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'caregiver_connections'
ORDER BY cmd, policyname;

-- ============================================================================
-- D1. Legacy-mirror revoke trigger installed on caregiver_connections.
-- EXPECT: 1 row, tgenabled = 'O'.
-- ============================================================================
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgrelid = 'public.caregiver_connections'::regclass
  AND tgname = 'trg_deactivate_legacy_caregiver_link_on_revoke';

-- ============================================================================
-- E1. reminder_events / reminder_logs must be SELECT-only for clients
--     (RLS pattern 6: mutations via RPC only).
-- EXPECT: every returned row has cmd = 'SELECT' — typically
--   reminder_events: "Users view own events", "Caregivers view patient events"
--   reminder_logs:   "Users view own logs",   "Caregivers view patient logs"
-- Zero rows with cmd IN ('INSERT','UPDATE','DELETE','ALL').
-- ============================================================================
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('reminder_events', 'reminder_logs')
ORDER BY tablename, cmd, policyname;

-- ============================================================================
-- E2. Hard assertion of E1 (returns a single boolean).
-- EXPECT: t
-- ============================================================================
SELECT NOT EXISTS (
  SELECT 1 FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('reminder_events', 'reminder_logs')
    AND cmd <> 'SELECT'
) AS dose_ledger_is_rpc_only;
