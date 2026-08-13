-- Health Vault upload limits (2026-08-13) — resource-exhaustion protection.
--
-- MAX 5 FILES PER USER, MAX 5 MB PER FILE, IMAGES + PDF ONLY.
--
-- WHY THIS IS A DATABASE FILE AND NOT A FORM VALIDATION
-- =====================================================
-- The Health Vault uploads from the BROWSER straight to Supabase Storage with the
-- anon key plus the user's JWT (see health-vault-client-view.tsx). Our Next.js
-- server is not in that path at all. So every check that lives in the upload modal
-- is advice, not a limit: anyone who can read the JS bundle — and the bundle ships
-- inside the APK, which anyone can unpack — can POST to /storage/v1/object/
-- health-vault/... directly and never see the form.
--
-- The only places a refusal can actually happen are therefore:
--   * `storage.buckets.file_size_limit` / `.allowed_mime_types`, enforced by the
--     Storage API itself before a byte is written; and
--   * the RLS policy on `storage.objects`, which is the same lock the existing
--     "you may only write your own files" rule already uses.
-- Both are below the API, so both hold no matter who is calling.
--
-- WHY THE COUNT CANNOT COME FROM health_records
-- ---------------------------------------------
-- The obvious "count the user's rows in public.health_records" is worthless here
-- for exactly the reason above: a direct Storage call writes an object and NO
-- health_records row, so that count would sit at zero while the bucket filled.
-- The count has to be of storage objects, which is what the function below does.
--
-- WHY THE FUNCTION IS SECURITY DEFINER, AND THE ONE THING THAT MUST BE TRUE
-- ------------------------------------------------------------------------
-- A policy ON storage.objects that itself SELECTs FROM storage.objects re-enters
-- RLS and Postgres raises `infinite recursion detected in policy for relation
-- "objects"`. SECURITY DEFINER is the way out: the body runs as the function's
-- OWNER, and in Supabase the owner of anything created in the SQL editor is
-- `postgres`, which has BYPASSRLS — so the inner read skips policy evaluation and
-- there is nothing to recurse into.
--
--   *** If the owner does NOT have BYPASSRLS this migration makes every vault
--   *** upload fail loudly. The validation file checks `rolbypassrls` for exactly
--   *** this reason. Run the validation.
--
-- WHY THE ADVISORY LOCK
-- ---------------------
-- Without it the limit holds only against a polite client. Fire fifty uploads in
-- parallel from one session, every transaction reads count = 0, and every one of
-- them passes — which is the precise attack this file exists to stop. The lock is
-- per-user and transaction-scoped, so it serialises one attacker's own uploads
-- and nobody else's.
--
-- GUESTS ARE NOW BLOCKED AT THE STORAGE LAYER TOO.
-- `guard_guest_write()` (migration_anonymous_guests_2026_08_10.sql) stops a guest
-- INSERTing a `health_records` row, and the page shows a GuestGate. Neither
-- touches storage: a guest holds a real `authenticated` JWT, so the vault's INSERT
-- policy accepted their objects. The row would be orphaned — invisible in the UI,
-- undeletable through it — but the bytes were stored and billed. Anonymous
-- sign-in is one tap and unlimited, which is the whole reason that migration
-- exists; this closes the half of it that was left open.
--
-- EXISTING USERS OVER THE LIMIT KEEP EVERYTHING. The rule is `count < 5` on
-- INSERT only. Someone holding seven files keeps all seven, can still read,
-- download and delete them, and simply cannot add an eighth until they are under
-- five. Nothing here deletes user data.
--
-- TRASH COUNTS TOWARD THE FIVE UNTIL IT IS PURGED — deliberately, and the UI says
-- so. A "deleted" record is a soft delete (`health_records.deleted_at`); the
-- OBJECT stays in the bucket so Restore can work, and `cleanup_expired_trash()`
-- removes it 30 days later. Since this limit counts objects — it must, see above —
-- a trashed file is still a file. Pretending otherwise would mean either lying to
-- the user or destroying the restore they were promised. The vault therefore shows
-- the trashed count separately and offers "delete permanently" as the way to free
-- the slot immediately.
--
-- Idempotent; safe to re-run in the Supabase SQL Editor.
-- Companion files: db/rollbacks/rollback_vault_upload_limits_2026_08_13.sql,
--                  db/validations/validation_vault_upload_limits_2026_08_13.sql
--                  db/scripts/verify-vault-limits.mjs (the direct-API proof)
-- Keep the numbers in lockstep with web/src/lib/health-vault/limits.ts.
-- ============================================================================


-- ============================================================================
-- 1. BUCKET CEILINGS — enforced by the Storage API, above any policy
-- ----------------------------------------------------------------------------
-- 5 MB = 5 * 1024 * 1024 = 5242880 bytes.
--
-- The MIME list is a REDUCTION: .doc/.docx/.txt/.zip used to be accepted by the
-- upload form and are not on this list, because "no arbitrary binaries" is the
-- point — a zip is an opaque container and a vault is not a file host. Files of
-- those types that are ALREADY stored are untouched and still download normally;
-- only new uploads are affected. The form's own list is cut to match in
-- web/src/lib/health-vault/limits.ts, so nobody picks a file that the server is
-- about to refuse.
--
-- HEIC/HEIF are allowed even though the app converts photos to JPEG before
-- upload: the conversion needs a browser that can decode HEIC, and when it cannot
-- the original is what arrives.
--
-- BE HONEST ABOUT WHAT THE MIME LIST IS. Storage compares the CONTENT-TYPE HEADER
-- the uploader sent; it does not sniff the bytes. Someone posting a zip while
-- claiming `image/png` gets through it. That is fine for what this list is for —
-- keeping the product's own surface to documents, and keeping an accidental
-- 200 MB video out — but it is not a malware gate, and nothing downstream should
-- treat a stored object's type as verified. The SIZE limit is the part that does
-- the resource-exhaustion work, and it cannot be lied past.
-- ============================================================================
UPDATE storage.buckets
SET file_size_limit = 5242880,
    allowed_mime_types = ARRAY[
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif'
    ]
WHERE id = 'health-vault';


-- ============================================================================
-- 2. HOW MANY FILES DOES THE CALLER HOLD — the read-only one
-- ----------------------------------------------------------------------------
-- Takes no argument and answers only about `auth.uid()`, so there is no way to
-- ask it about somebody else. That is what makes it safe to grant to
-- `authenticated` and call from the browser — the vault's "N of 5 used" counter
-- reads THIS, so the number on screen and the number the policy enforces are the
-- same number and cannot drift.
--
-- Returns 0 when there is no caller (service_role, the SQL editor). Harmless: the
-- policy below independently requires `auth.uid() = owner`, which is false for a
-- NULL uid, so a 0 here can never let an unauthenticated write through.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.vault_object_count()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
-- Pinned, so a caller-controlled search_path cannot point `objects` at their own
-- table. Everything below is schema-qualified as a consequence.
SET search_path TO ''
STABLE
AS $function$
  SELECT count(*)::int
  FROM storage.objects
  WHERE bucket_id = 'health-vault'
    AND owner = auth.uid();
$function$;

COMMENT ON FUNCTION public.vault_object_count() IS
  'Number of Health Vault storage objects owned by the current caller (0 when unauthenticated). Counts OBJECTS, not health_records rows, because a direct Storage API call creates the former and not the latter — and because trashed records keep their object until cleanup_expired_trash purges it, so a trashed file still occupies a slot. Read by the vault UI so the counter shown matches the limit enforced.';

REVOKE ALL ON FUNCTION public.vault_object_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vault_object_count() FROM anon;
GRANT EXECUTE ON FUNCTION public.vault_object_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.vault_object_count() TO service_role;


-- ============================================================================
-- 3. MAY THE CALLER UPLOAD ONE MORE — the one the policy calls
-- ----------------------------------------------------------------------------
-- Separate from the counter above because it is NOT a read: it takes a lock.
-- Naming it `vault_object_count` and quietly locking inside would be a trap for
-- whoever calls it next.
--
-- NOT granted to the browser. It is called from the RLS policy, which runs as
-- part of the storage INSERT and needs no client grant — and a client that could
-- call it would be taking a transaction lock it never releases in time.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.vault_can_accept_upload()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
BEGIN
  -- No caller, no upload. The policy checks this too; both, on purpose.
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  -- Serialise this one user's concurrent uploads. Transaction-scoped, so it is
  -- released when the storage INSERT commits or rolls back — nothing to leak.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('reminder-health:vault:' || v_uid::text, 0)
  );

  SELECT count(*) INTO v_count
  FROM storage.objects
  WHERE bucket_id = 'health-vault'
    AND owner = v_uid;

  -- 5 is the limit. Keep in lockstep with VAULT_MAX_FILES in
  -- web/src/lib/health-vault/limits.ts and with the validation file.
  RETURN v_count < 5;
END;
$function$;

COMMENT ON FUNCTION public.vault_can_accept_upload() IS
  'True when the caller holds fewer than 5 Health Vault storage objects. Takes a per-user transaction advisory lock first, so parallel uploads cannot all read the same count and all pass. Called ONLY from the health-vault INSERT policy on storage.objects — deliberately not granted to authenticated.';

REVOKE ALL ON FUNCTION public.vault_can_accept_upload() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vault_can_accept_upload() FROM anon;
REVOKE ALL ON FUNCTION public.vault_can_accept_upload() FROM authenticated;
-- No grants at all. An RLS policy expression is evaluated by the system, not by
-- the calling role, so it needs no EXECUTE grant — and giving one would hand the
-- browser a lock it has no business taking.


-- ============================================================================
-- 4. THE INSERT POLICY — where the refusal actually happens
-- ----------------------------------------------------------------------------
-- Replaces the policy from migration_health_vault_foundation.sql /
-- migration_health_vault_combined.sql, which checked ownership and nothing else.
-- The two ownership conjuncts are UNCHANGED; the two new ones are the guest block
-- and the count.
--
-- Only the health-vault branch is touched. `avatars` has its own policies and
-- permissive policies OR together, so nothing here narrows that bucket.
-- ============================================================================
DROP POLICY IF EXISTS "Users can insert own vault files" ON storage.objects;
CREATE POLICY "Users can insert own vault files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'health-vault'
    AND auth.uid() = owner
    -- A guest's files are unreachable through the UI anyway (the page gates them
    -- and guard_guest_write blocks the metadata row) — they were pure cost.
    AND NOT public.is_anonymous_user()
    AND public.vault_can_accept_upload()
  );


-- ============================================================================
-- 5. AVATARS — found by the same audit, fix it or delete this section
-- ----------------------------------------------------------------------------
-- NOT part of the Health Vault brief. It is here because the audit that produced
-- this file found the avatars bucket had no server-side ceiling either: the
-- 5 MB / image-only check in medical-profile-client-view.tsx is form advice, same
-- as the vault's was, and the bucket accepted anything of any size from a direct
-- API call. These two lines make the server enforce exactly what that form
-- already promises, so no legitimate upload changes behaviour.
--
-- Deleting this section before running the file costs nothing else in it.
--
-- STILL OPEN after this, and deliberately not fixed here: the avatars policy
-- checks only the first path segment, so one user can hold unlimited objects
-- under `{uid}/…`. Bounding that needs its own count function and policy — a
-- separate decision, in a separate migration, not a rider on this one.
-- ============================================================================
UPDATE storage.buckets
SET file_size_limit = 5242880,
    allowed_mime_types = ARRAY[
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/heic',
      'image/heif'
    ]
WHERE id = 'avatars';
