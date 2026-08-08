-- VALIDATION for migration_fix_reminder_logs_anon_read.sql (run AFTER applying).
-- Every row below should report OK. Then re-run the anon curl probe in the migration header;
-- it must return Content-Range: */0 for BOTH reminder_logs and reminder_events.

-- 1. RLS enabled AND forced on both tables.
SELECT 'rls_forced' AS check,
       c.relname AS object,
       CASE WHEN c.relrowsecurity AND c.relforcerowsecurity THEN 'OK' ELSE 'FAIL' END AS result
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('reminder_logs','reminder_events');

-- 2. No USING(true) / always-true SELECT policy survives on either table.
SELECT 'no_permissive_select' AS check,
       p.tablename || ' :: ' || p.policyname AS object,
       'FAIL — remove this policy' AS result
FROM pg_policies p
WHERE p.schemaname = 'public'
  AND p.tablename IN ('reminder_logs','reminder_events')
  AND p.cmd IN ('SELECT','ALL')
  AND coalesce(p.qual,'true') = 'true';   -- rows here = still leaking

-- 3. The scoped self-read policies exist.
SELECT 'self_read_present' AS check, x.object,
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_policies p
         WHERE p.schemaname='public' AND p.tablename=x.tbl AND p.policyname=x.pol
       ) THEN 'OK' ELSE 'FAIL — missing' END AS result
FROM (VALUES
  ('reminder_logs',   'Users view own logs'),
  ('reminder_logs',   'Caregivers view patient logs'),
  ('reminder_events', 'Users view own events')
) AS x(tbl, pol) CROSS JOIN LATERAL (SELECT x.tbl || ' :: ' || x.pol) AS y(object);
