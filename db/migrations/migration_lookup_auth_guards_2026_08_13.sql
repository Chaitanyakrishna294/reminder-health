-- RE-MIND-eЯ: auth guards inside the two directory lookups. 2026-08-13.
-- Idempotent — safe to re-run in the Supabase SQL Editor.
-- ============================================================================
--
-- TWO LOCKS ON EVERY DOOR. migration_revoke_anon_execute_sweep_2026_08_13.sql took
-- anon's EXECUTE away, which is the grant lock. This adds the body lock. Neither is
-- redundant: the grant is what an ACL accident can silently undo — and this codebase
-- has now watched exactly that happen, twice, because `REVOKE ... FROM anon` against
-- PUBLIC-derived access is a no-op that raises no error. A function whose only
-- defence is its ACL is one default-privileges quirk away from being open again.
--
-- WHAT THESE FUNCTIONS DO, and why they are worth two locks: both take a short code
-- and return a real person's name and profile UUID. They are the only functions in
-- the schema that turn a guessable string into PII, so they are the ones where "the
-- grant will hold" is not good enough.
--
-- VERIFIED BEFORE ADDING THE GUARD — every legitimate caller is authenticated:
--   * The ONLY call site of either is web/src/app/(dashboard)/settings/
--     settings-client-view.tsx:190 and :197, inside the (dashboard) route group,
--     which the proxy and the layout both gate on a session.
--   * Neither appears anywhere in src/ (the Render bot) or in any API route, so no
--     service_role caller exists. That matters: service_role has NO auth.uid(), so
--     a guard like this would break a bot caller silently — there just isn't one.
--
-- NOT CHANGED: the queries, the return shapes, the search_path, or the grants. Each
-- function gains four lines at the top and nothing else, so a caller who was already
-- allowed sees identical behaviour.
--
-- CREATE OR REPLACE, never DROP+CREATE — a DROP would take the grants with it and
-- hand the ACL problem straight back.
-- ============================================================================

-- ── 1. Connect Code → profile (the universal code, works for web-only accounts) ──
CREATE OR REPLACE FUNCTION public.lookup_profile_by_connect_code(p_code text)
RETURNS TABLE (profile_id uuid, full_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- `auth.uid()` is schema-qualified, so it resolves even though `auth` is not on
  -- the pinned search_path. Do not "fix" that by widening the path.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  RETURN QUERY
  -- p.full_name stays qualified: `full_name` is also an OUT variable from RETURNS
  -- TABLE, and an unqualified reference is a 42702 ambiguity that only shows up at
  -- runtime. Same trap that shipped a broken snooze RPC in August.
  SELECT p.id, COALESCE(p.full_name, 'User')
  FROM public.profiles p
  WHERE p.connect_code = upper(trim(p_code))
  LIMIT 1;
END;
$$;

-- ── 2. Legacy CG-ID → caregiver profile ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lookup_caregiver_by_code(p_cg_id TEXT)
RETURNS TABLE (caregiver_profile_id UUID, caregiver_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  RETURN QUERY
  -- ci.caregiver_name qualified for the same OUT-variable reason as above.
  SELECT p.id, COALESCE(p.full_name, ci.caregiver_name, 'Caregiver')
  FROM public.caregiver_info ci
  JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
  WHERE ci.caregiver_id = upper(trim(p_cg_id))
    AND ci.is_active = true
  LIMIT 1;
END;
$$;

-- ── Grants, restated per the template ───────────────────────────────────────
-- Both revokes, because they are not interchangeable — see
-- db/migrations/_TEMPLATE_new_rpc.sql. Restated here so this file is correct on its
-- own even if it is ever applied out of order with the sweep.
REVOKE ALL ON FUNCTION public.lookup_profile_by_connect_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lookup_profile_by_connect_code(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.lookup_profile_by_connect_code(text) TO authenticated;

REVOKE ALL ON FUNCTION public.lookup_caregiver_by_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lookup_caregiver_by_code(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.lookup_caregiver_by_code(text) TO authenticated;

-- STILL OPEN, deliberately out of scope: an AUTHENTICATED user can still walk the
-- code space — the guard stops strangers, not a signed-in attacker. Guest accounts
-- are one tap to create, so that is a real ceiling on what this buys. If it matters
-- before launch, the tool already exists: route these two through check_rate_limit
-- the way the other abuse-prone paths do. Noted rather than done, because it is a
-- behaviour change to a working flow and deserves its own decision.
