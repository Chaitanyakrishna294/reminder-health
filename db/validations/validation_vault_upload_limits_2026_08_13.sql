-- Validation for migration_vault_upload_limits_2026_08_13.sql
--
-- ONE query, because the Supabase SQL editor shows only the last statement's
-- result — separate SELECTs would hide every check but the final one.
--
-- Every row should read DONE, except the last two, which are INFO and exist to be
-- read rather than passed.
--
-- CHECK 5 IS THE ONE THAT MATTERS MOST. If `owner_bypasses_rls` is false, the
-- INSERT policy will recurse into itself and EVERY vault upload will fail with
-- `infinite recursion detected in policy for relation "objects"`. Roll back
-- immediately if it does; do not try to debug it live.
--
-- Catalog checks cannot prove a plpgsql body works — plpgsql compiles on FIRST
-- EXECUTION, so a function with a typo in it passes every check here and throws
-- the moment a real caller arrives. Check 10 is therefore a real call.
-- ============================================================================

WITH
bucket AS (
  SELECT file_size_limit, allowed_mime_types
  FROM storage.buckets WHERE id = 'health-vault'
),
avatars AS (
  SELECT file_size_limit, allowed_mime_types
  FROM storage.buckets WHERE id = 'avatars'
),
fn_count AS (
  SELECT p.oid, p.proacl, p.proconfig, p.proowner
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'vault_object_count'
),
fn_accept AS (
  SELECT p.oid, p.proacl, p.proconfig, p.proowner
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'vault_can_accept_upload'
),
pol AS (
  SELECT pg_get_expr(polwithcheck, polrelid) AS with_check
  FROM pg_policy
  WHERE polname = 'Users can insert own vault files'
    AND polrelid = 'storage.objects'::regclass
),
-- Every public function NAMED in the policy expression, pulled out of the
-- expression itself rather than hardcoded — so this keeps working when someone
-- adds a conjunct. `auth.uid()` matches as `uid`, which is not a public function
-- and drops out of the join.
policy_fn_names AS (
  SELECT DISTINCT parts[1] AS fname
  FROM pol, regexp_matches(pol.with_check, '([a-z_][a-z0-9_]*)\s*\(', 'g') AS m(parts)
),
policy_fns AS (
  SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS callable
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (SELECT fname FROM policy_fn_names)
)

SELECT 1 AS chk, 'health-vault file_size_limit is 5 MB' AS what,
       coalesce((SELECT file_size_limit FROM bucket), -1)::text AS observed,
       CASE WHEN (SELECT file_size_limit FROM bucket) = 5242880 THEN 'DONE' ELSE 'FAIL' END AS verdict

UNION ALL
SELECT 2, 'health-vault mime list is images + pdf only',
       coalesce(array_to_string((SELECT allowed_mime_types FROM bucket), ', '), '(null = anything)'),
       -- Sorted before comparing, so the order the array was written in is not
       -- part of the assertion. A NULL mime list means "anything goes" and
       -- array_agg gives NULL, which lands on FAIL — correctly.
       CASE WHEN (SELECT array_agg(m ORDER BY m) FROM bucket, unnest(allowed_mime_types) AS m)
                 = ARRAY['application/pdf','image/heic','image/heif','image/jpeg','image/png','image/webp']
            THEN 'DONE' ELSE 'FAIL' END

UNION ALL
SELECT 3, 'avatars bucket has a server-side ceiling too',
       coalesce((SELECT file_size_limit FROM avatars), -1)::text
         || ' bytes / ' || coalesce(array_length((SELECT allowed_mime_types FROM avatars), 1), 0)::text || ' mime types',
       -- Skip-tolerant: section 5 of the migration is explicitly optional, so a
       -- NULL here is a decision, not a failure. It still has to be visible.
       CASE WHEN (SELECT file_size_limit FROM avatars) = 5242880 THEN 'DONE'
            WHEN (SELECT file_size_limit FROM avatars) IS NULL THEN 'SKIPPED (section 5 not run)'
            ELSE 'FAIL' END

UNION ALL
SELECT 4, 'both functions exist',
       (SELECT count(*) FROM fn_count)::text || ' + ' || (SELECT count(*) FROM fn_accept)::text,
       CASE WHEN (SELECT count(*) FROM fn_count) = 1 AND (SELECT count(*) FROM fn_accept) = 1
            THEN 'DONE' ELSE 'FAIL' END

UNION ALL
-- THE RECURSION GUARD. SECURITY DEFINER only escapes RLS if the owner is exempt
-- from it. Supabase's `postgres` role is; a role created later might not be.
SELECT 5, 'function owner bypasses RLS (or the policy recurses)',
       (SELECT r.rolname || ' bypassrls=' || r.rolbypassrls::text
        FROM pg_roles r WHERE r.oid = (SELECT proowner FROM fn_accept)),
       CASE WHEN (SELECT r.rolbypassrls FROM pg_roles r
                  WHERE r.oid = (SELECT proowner FROM fn_accept)) IS TRUE
            THEN 'DONE' ELSE 'FAIL' END

UNION ALL
SELECT 6, 'search_path pinned on both',
       coalesce(array_to_string((SELECT proconfig FROM fn_count), ' | '), 'none')
         || ' / ' || coalesce(array_to_string((SELECT proconfig FROM fn_accept), ' | '), 'none'),
       CASE WHEN (SELECT proconfig FROM fn_count) IS NOT NULL
             AND (SELECT proconfig FROM fn_accept) IS NOT NULL
            THEN 'DONE' ELSE 'FAIL' END

UNION ALL
-- A NULL proacl is Postgres's default, which is EXECUTE to PUBLIC — and every
-- role is PUBLIC, including anon, the key shipped inside the APK. Checking
-- has_function_privilege alone is not enough; check the acl exists.
SELECT 7, 'vault_object_count: acl set, anon revoked, authenticated granted',
       coalesce((SELECT proacl FROM fn_count)::text, 'NULL (= PUBLIC!)'),
       CASE WHEN (SELECT proacl FROM fn_count) IS NOT NULL
             AND NOT has_function_privilege('anon', (SELECT oid FROM fn_count), 'EXECUTE')
             AND has_function_privilege('authenticated', (SELECT oid FROM fn_count), 'EXECUTE')
            THEN 'DONE' ELSE 'FAIL' END

UNION ALL
-- REWRITTEN 2026-08-13. This check used to assert that `authenticated` had NO
-- execute on this function — it asserted the bug, and passed while every vault
-- upload was failing with `permission denied for function`. A policy expression
-- is evaluated with the querying role's privileges; SECURITY DEFINER governs
-- which role the BODY runs as, not who may CALL it. See
-- migration_vault_can_accept_grant_2026_08_13.sql.
SELECT 8, 'vault_can_accept_upload: acl set, anon revoked, authenticated GRANTED',
       coalesce((SELECT proacl FROM fn_accept)::text, 'NULL (= PUBLIC!)'),
       CASE WHEN (SELECT proacl FROM fn_accept) IS NOT NULL
             AND NOT has_function_privilege('anon', (SELECT oid FROM fn_accept), 'EXECUTE')
             AND has_function_privilege('authenticated', (SELECT oid FROM fn_accept), 'EXECUTE')
            THEN 'DONE' ELSE 'FAIL' END

UNION ALL
SELECT 9, 'INSERT policy carries the count AND the guest block',
       coalesce((SELECT with_check FROM pol), '(policy missing)'),
       CASE WHEN (SELECT with_check FROM pol) LIKE '%vault_can_accept_upload%'
             AND (SELECT with_check FROM pol) LIKE '%is_anonymous_user%'
            THEN 'DONE' ELSE 'FAIL' END

UNION ALL
-- COMPILE PROBE. Runs both bodies for real. In the SQL editor auth.uid() is NULL,
-- so the expected answers are 0 and false — which also proves the unauthenticated
-- path refuses rather than counting somebody else's files.
SELECT 10, 'compile probe: both bodies actually run',
       'count=' || public.vault_object_count()::text
         || ' can_accept=' || public.vault_can_accept_upload()::text,
       CASE WHEN public.vault_object_count() = 0
             AND public.vault_can_accept_upload() = false
            THEN 'DONE' ELSE 'FAIL' END

UNION ALL
-- THE CHECK THAT WOULD HAVE CAUGHT THE OUTAGE, written to be general rather than
-- to name today's two functions: EVERY public function the policy calls must be
-- executable by `authenticated`, because a policy expression is evaluated with
-- the querying role's privileges. Reads the names out of the policy expression,
-- so a conjunct added next year is covered without editing this file.
SELECT 13, 'every function the policy calls is executable by authenticated',
       coalesce((SELECT string_agg(proname || '=' || callable::text, ', ' ORDER BY proname)
                 FROM policy_fns), '(none found)'),
       CASE WHEN (SELECT count(*) FROM policy_fns) >= 2
             AND NOT EXISTS (SELECT 1 FROM policy_fns WHERE callable IS NOT TRUE)
            THEN 'DONE' ELSE 'FAIL' END

UNION ALL
-- INFO, not a check. Nobody is deleted to enforce this rule; these people simply
-- cannot add another file until they are back under five.
SELECT 11, 'INFO — users already over 5 files (they keep everything)',
       coalesce((SELECT count(*)::text FROM (
         SELECT owner FROM storage.objects
         WHERE bucket_id = 'health-vault' AND owner IS NOT NULL
         GROUP BY owner HAVING count(*) > 5
       ) s), '0') || ' user(s)',
       'INFO'

UNION ALL
SELECT 12, 'INFO — vault objects with no owner (unreachable by any policy)',
       (SELECT count(*)::text FROM storage.objects
        WHERE bucket_id = 'health-vault' AND owner IS NULL) || ' object(s)',
       'INFO'

ORDER BY chk;
