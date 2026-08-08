-- DIAGNOSTIC ONLY - reads nothing but catalog metadata, changes nothing.
--
-- Why: with the PUBLIC anon key alone and no signed-in user, this returns 221 rows:
--   GET /rest/v1/reminder_logs?select=id   ->  HTTP 200, Content-Range 0-220/221
-- while the same request against `medications` correctly returns zero. So dose history
-- is readable by anyone who lifts the anon key out of the JS bundle.
--
-- The repo's migrations DO define correctly scoped policies (migration_fix_rls.sql
-- and others gate on telegram_id), so the live database has drifted from them. This
-- tells you how. Run it in the Supabase SQL editor and send the output.

SELECT
  'rls_enabled' AS what,
  c.relname     AS object,
  CASE WHEN c.relrowsecurity THEN 'ENABLED' ELSE 'DISABLED  <-- everything is readable' END AS detail
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('reminder_logs','reminder_events','medications')

UNION ALL

SELECT
  'policy',
  p.tablename || ' :: ' || p.policyname,
  'cmd=' || p.cmd
    || '  roles=' || array_to_string(p.roles, ',')
    || '  using=' || coalesce(left(p.qual, 120), '(none)')
FROM pg_policies p
WHERE p.schemaname = 'public'
  AND p.tablename IN ('reminder_logs','reminder_events')

ORDER BY 1, 2;
