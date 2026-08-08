-- ROLLBACK for migration_redeem_link_code_ratelimit_2026_08_08.sql
-- Restores redeem_link_code to its prior body (no in-DB rate limit), verbatim from
-- migration_link_codes_hardening_2026_07.sql. Note: reverting removes the brute-force guard;
-- only the API route's IP limit remains (bypassable by calling the RPC directly).

CREATE OR REPLACE FUNCTION public.redeem_link_code(p_code text)
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

GRANT EXECUTE ON FUNCTION public.redeem_link_code(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.redeem_link_code(text) FROM anon;
