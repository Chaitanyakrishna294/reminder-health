-- READ-ONLY state check — paste this whole thing into the Supabase SQL editor and run it.
-- It changes NOTHING. It reports what is currently applied so you know what's left to do
-- and whether you need to re-apply the two corrected migrations. Read the `status` column.

SELECT check_name, status, detail FROM (

  -- A1: reminder_logs / reminder_events must have RLS ENABLED and FORCED.
  SELECT 1 AS ord, 'A1 rls_forced' AS check_name,
         CASE WHEN bool_and(c.relrowsecurity AND c.relforcerowsecurity) THEN 'DONE' ELSE 'TODO' END AS status,
         string_agg(c.relname || '=' || c.relrowsecurity::text || '/' || c.relforcerowsecurity::text, ', ') AS detail
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relname IN ('reminder_logs','reminder_events')

  UNION ALL
  -- A1: the leak — any always-true SELECT policy still present = STILL LEAKING.
  SELECT 2, 'A1 anon_leak_closed',
         CASE WHEN count(*)=0 THEN 'DONE' ELSE 'TODO — STILL LEAKING' END,
         COALESCE(string_agg(tablename||'::'||policyname,', '),'no permissive policy (good)')
  FROM pg_policies
  WHERE schemaname='public' AND tablename IN ('reminder_logs','reminder_events')
    AND cmd IN ('SELECT','ALL') AND COALESCE(qual,'true')='true'

  UNION ALL
  -- A1 (corrected): caregiver logs policy must be GATED on can_view_reports.
  SELECT 3, 'A1 caregiver_logs_gated',
         CASE WHEN bool_or(qual ILIKE '%can_view_reports%') THEN 'DONE'
              WHEN count(*)=0 THEN 'TODO — policy missing'
              ELSE 'RE-APPLY — over-grant (old version)' END,
         COALESCE(string_agg(policyname,', '),'(none)')
  FROM pg_policies
  WHERE schemaname='public' AND tablename='reminder_logs' AND policyname='Caregivers view patient logs'

  UNION ALL
  -- A2: check_rate_limit must NOT be executable by anon/authenticated (service_role only).
  SELECT 4, 'A2 check_rate_limit_locked',
         CASE WHEN has_function_privilege('authenticated','public.check_rate_limit(text,int,int)','EXECUTE')
                OR has_function_privilege('anon','public.check_rate_limit(text,int,int)','EXECUTE')
              THEN 'TODO' ELSE 'DONE' END,
         'authenticated/anon should both be false'

  UNION ALL
  -- A2: get_policies_debug should be gone.
  SELECT 5, 'A2 policies_debug_dropped',
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                           WHERE n.nspname='public' AND p.proname='get_policies_debug')
              THEN 'TODO' ELSE 'DONE' END,
         ''

  UNION ALL
  -- A3: redeem_link_code must RETURN text (the rate-limited version), not void.
  SELECT 6, 'A3 redeem_returns_text',
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                           WHERE n.nspname='public' AND p.proname='redeem_link_code'
                             AND pg_get_function_result(p.oid)='text')
              THEN 'DONE' ELSE 'TODO' END,
         (SELECT COALESCE(pg_get_function_result(p.oid),'(missing)') FROM pg_proc p
          JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='redeem_link_code' LIMIT 1)

  UNION ALL
  -- A4: search_path pinned on the helper functions (spot-check handle_new_user).
  SELECT 7, 'A4 search_path_pinned',
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                           WHERE n.nspname='public' AND p.proname='handle_new_user'
                             AND array_to_string(p.proconfig,',') ILIKE '%search_path%')
              THEN 'DONE' ELSE 'TODO' END,
         'spot-checks handle_new_user; migration pins 7 fns'

  UNION ALL
  -- B1 (corrected): the guard trigger must exist AND its function must be INVOKER (prosecdef=false).
  SELECT 8, 'B1 telegram_guard',
         CASE WHEN NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_guard_profile_telegram_chat_id' AND NOT tgisinternal)
                THEN 'TODO — trigger missing'
              WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                           WHERE n.nspname='public' AND p.proname='guard_profile_telegram_chat_id' AND p.prosecdef)
                THEN 'RE-APPLY — SECURITY DEFINER (no-op, old version)'
              ELSE 'DONE' END,
         ''

  UNION ALL
  -- B2: profiles SELECT policy must require ACCEPTED, and the names RPC must exist.
  SELECT 9, 'B2 profiles_accepted',
         CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles'
                           AND policyname='Allow users to read their own profile' AND qual ILIKE '%connection_status%')
              THEN 'DONE' ELSE 'TODO' END,
         ''
  UNION ALL
  SELECT 10, 'B2 names_rpc',
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                           WHERE n.nspname='public' AND p.proname='get_connection_counterpart_names')
              THEN 'DONE' ELSE 'TODO' END,
         ''

) t ORDER BY ord;
