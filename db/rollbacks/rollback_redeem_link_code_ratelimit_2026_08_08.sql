-- ROLLBACK for migration_redeem_link_code_ratelimit_2026_08_08.sql
-- Restores redeem_link_code to its prior VOID-returning, RAISE-on-error body (verbatim from
-- migration_link_codes_hardening_2026_07.sql, no in-DB rate limit).
--
-- WARNING 1: reverting removes the brute-force guard; only the API route's IP limit remains
-- (bypassable by calling the RPC directly).
-- WARNING 2: the forward migration changed the return type void -> text and the redeem route was
-- updated to read the returned status. The route is written to ALSO handle the old RAISE-based
-- errors, so a DB-only rollback degrades gracefully; still, redeploy the matching route if you
-- want a clean revert. Return type change requires DROP first.

DROP FUNCTION IF EXISTS public.redeem_link_code(text);

CREATE FUNCTION public.redeem_link_code(p_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid uuid;
  v_hash text;
  v_row record;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_hash := encode(sha256(convert_to(upper(trim(p_code)), 'UTF8')), 'hex');

  SELECT * INTO v_row FROM public.link_codes WHERE code_hash = v_hash FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid code';
  END IF;

  IF v_row.expires_at < now() THEN
    RAISE EXCEPTION 'Code expired';
  END IF;

  BEGIN
    UPDATE public.profiles SET telegram_chat_id = v_row.telegram_chat_id WHERE id = v_uid;
    DELETE FROM public.link_codes WHERE id = v_row.id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Already linked';
  END;
END;
$$;

-- DROP+CREATE reset the ACL to the default PUBLIC EXECUTE; REVOKE FROM anon alone does NOT
-- remove the PUBLIC grant (anon is a member of PUBLIC), so REVOKE FROM PUBLIC too — otherwise
-- this rollback would silently re-open the grant that migration_rpc_grant_lockdown closed.
GRANT EXECUTE ON FUNCTION public.redeem_link_code(text) TO authenticated;
REVOKE ALL     ON FUNCTION public.redeem_link_code(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.redeem_link_code(text) FROM anon;
