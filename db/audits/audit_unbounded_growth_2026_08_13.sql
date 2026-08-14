-- Unbounded-growth audit (2026-08-13). READ ONLY — writes nothing, changes nothing.
--
-- Written alongside migration_vault_upload_limits_2026_08_13.sql to answer the
-- question that migration raises: the Health Vault was one place a signed-in user
-- could consume storage without limit, so where are the others?
--
-- THE SHAPE OF THE RISK. Anonymous sign-in is on, it is one tap, and it is free
-- and unlimited (migration_anonymous_guests_2026_08_10.sql says so in its own
-- header). So "a signed-in user could do this a million times" is not a
-- hypothetical about a trusted user — it is a claim about anybody with a browser.
-- Anything a client can INSERT without a bound is therefore a bill.
--
-- Run the whole file; each section prints its own result set.
-- ============================================================================


-- ── 1. Which client-writable tables can an authenticated user INSERT into ────
-- A table with an INSERT (or FOR ALL) policy granted to `authenticated` is one a
-- browser can append to directly. That is fine for tables with a natural bound
-- (one profile per user) and is the thing to look at for tables without one.
SELECT
  c.relname                                                   AS table_name,
  pol.polname                                                 AS policy,
  CASE pol.polcmd WHEN 'a' THEN 'INSERT' WHEN '*' THEN 'ALL' END AS command,
  pg_get_expr(pol.polwithcheck, pol.polrelid)                 AS with_check
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND pol.polcmd IN ('a', '*')
  AND EXISTS (
    SELECT 1 FROM pg_roles r
    WHERE r.oid = ANY (pol.polroles) AND r.rolname IN ('authenticated', 'anon', 'public')
  )
ORDER BY c.relname, pol.polname;


-- ── 2. How big is each of those tables actually ──────────────────────────────
-- Size, not just row count: a table of small rows growing fast and a table of
-- JSONB blobs growing slowly are different problems.
SELECT
  relname AS table_name,
  n_live_tup AS approx_rows,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 25;


-- ── 3. Storage buckets: is there a server-side ceiling at all ────────────────
-- NULL in either column means the Storage API imposes nothing of its own and the
-- only limits are whatever the RLS policies happen to say.
SELECT
  id AS bucket,
  public AS is_public,
  COALESCE(file_size_limit::text, 'NONE — any size') AS per_file_limit,
  COALESCE(array_to_string(allowed_mime_types, ', '), 'NONE — any type') AS allowed_types
FROM storage.buckets
ORDER BY id;


-- ── 4. Who is holding how much, per bucket ───────────────────────────────────
-- The top holders. A single owner far ahead of the rest is either a power user or
-- the answer to "is this being abused".
SELECT
  bucket_id,
  count(*) AS objects,
  count(DISTINCT owner) AS owners,
  pg_size_pretty(COALESCE(sum((metadata ->> 'size')::bigint), 0)) AS total_bytes,
  max((SELECT count(*) FROM storage.objects o2
       WHERE o2.bucket_id = o.bucket_id AND o2.owner = o.owner)) AS most_held_by_one_owner
FROM storage.objects o
GROUP BY bucket_id
ORDER BY bucket_id;


-- ── 5. Orphaned vault objects — bytes nothing in the UI can reach ────────────
-- An object with no matching health_records row is invisible in the vault, so
-- nobody can delete it through the app, and cleanup_expired_trash() only ever
-- looks at rows. Every one of these is paid for forever. A non-zero count here is
-- also the signature of an upload that bypassed the form.
SELECT
  count(*) AS orphaned_objects,
  pg_size_pretty(COALESCE(sum((o.metadata ->> 'size')::bigint), 0)) AS wasted_bytes
FROM storage.objects o
WHERE o.bucket_id = 'health-vault'
  AND NOT EXISTS (
    SELECT 1 FROM public.health_records hr WHERE hr.file_url = o.name
  );


-- ── 6. audit_logs — the one to look at hardest ───────────────────────────────
-- `"Users can manage their own audit logs" FOR ALL TO authenticated` means the
-- client may INSERT freely, and the vault client does exactly that on every
-- upload, delete, restore and edit. There is no cleanup job for this table and no
-- rate limit on it: a loop can append rows as fast as the network allows, and
-- `details` is JSONB, so each row can be large.
--
-- Nothing about that is wrong for a compliance log written by trusted code — the
-- question is only whether the client should be the one writing it. Numbers here
-- inform that decision rather than settling it.
SELECT
  count(*) AS total_rows,
  count(DISTINCT user_id) AS distinct_users,
  pg_size_pretty(pg_total_relation_size('public.audit_logs')) AS table_size,
  min(created_at) AS oldest,
  max(created_at) AS newest
FROM public.audit_logs;

-- The busiest writers, and whether any of them are guests.
SELECT
  al.user_id,
  count(*) AS rows_written,
  (u.is_anonymous IS TRUE) AS is_guest
FROM public.audit_logs al
LEFT JOIN auth.users u ON u.id = al.user_id
GROUP BY al.user_id, u.is_anonymous
ORDER BY count(*) DESC
LIMIT 10;


-- ── 7. notifications — bounded, confirming it stays that way ─────────────────
-- migration_notifications_no_client_insert_2026_07.sql removed the client INSERT
-- policy, so rows are only ever produced by triggers and service_role. That makes
-- growth proportional to real events rather than to attacker patience. This check
-- exists to catch a policy being added back, not because a problem is expected.
SELECT
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'notifications'
      AND pol.polcmd IN ('a', '*')
      AND EXISTS (SELECT 1 FROM pg_roles r
                  WHERE r.oid = ANY (pol.polroles) AND r.rolname IN ('authenticated', 'anon'))
  ) THEN 'REGRESSION — a client INSERT policy is back on notifications'
  ELSE 'OK — no client INSERT policy on notifications'
  END AS notifications_insert_status,
  (SELECT count(*) FROM public.notifications) AS total_rows,
  (SELECT pg_size_pretty(pg_total_relation_size('public.notifications'))) AS table_size;
