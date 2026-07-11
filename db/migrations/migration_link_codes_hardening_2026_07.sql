-- Harden link_codes against two independent account-hijack paths:
--   1. An always-true RLS policy let any authenticated user browse, redeem, or delete
--      ANY pending link code (profiles.telegram_chat_id drives every patient/caregiver
--      data relationship in the schema, so redeeming a code is a full identity hijack).
--   2. Redemption had no rate limiting (1,000,000-code space, 15-min TTL, brute-forceable).
-- Fix: hash the code at rest (matches phone_verifications.code_hash), remove all direct
-- client access to the table, and move redemption behind a SECURITY DEFINER RPC that a
-- new rate-limited API route calls (web/src/app/api/link-account/redeem/route.ts).
-- Also fixes a non-atomic bug: the old flow updated profiles then deleted the code as two
-- separate, unguarded client calls (the delete had no error handling) — a silent delete
-- failure left a "used" code redeemable again for up to 15 more minutes. The RPC below
-- does both in one transaction. See docs/superpowers/specs/2026-07-11-link-codes-hardening-design.md.

ALTER TABLE public.link_codes ADD COLUMN code_hash text;
ALTER TABLE public.link_codes DROP COLUMN code;

-- No replacement policy: direct client access to this table is never legitimate again.
-- The bot writes via its service_role key, which bypasses RLS regardless.
DROP POLICY IF EXISTS "Allow code verification by authenticated users" ON public.link_codes;

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

  -- Bot always generates uppercase codes ('RMDR-' + digits); normalize the same way here
  -- so a user-pasted code with stray whitespace or lowercase still matches.
  v_hash := encode(sha256(convert_to(upper(trim(p_code)), 'UTF8')), 'hex');

  -- FOR UPDATE: without a row lock, two concurrent redemptions of the SAME code could both
  -- pass this lookup before either DELETEs it, linking one code to two profiles. Locking
  -- makes the second transaction wait, then see NOT FOUND once the first commits.
  SELECT * INTO v_row FROM public.link_codes WHERE code_hash = v_hash FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid code';
  END IF;

  IF v_row.expires_at < now() THEN
    DELETE FROM public.link_codes WHERE id = v_row.id;
    RAISE EXCEPTION 'Code expired';
  END IF;

  -- telegram_chat_id is UNIQUE on profiles: if this Telegram identity is already linked to
  -- a DIFFERENT profile, the UPDATE raises unique_violation. Consume the code either way
  -- (it revealed real information; leaving it valid would let the same conflict be probed
  -- again) and surface a clean, matchable error instead of an opaque 500.
  BEGIN
    UPDATE public.profiles SET telegram_chat_id = v_row.telegram_chat_id WHERE id = v_uid;
    DELETE FROM public.link_codes WHERE id = v_row.id;
  EXCEPTION WHEN unique_violation THEN
    DELETE FROM public.link_codes WHERE id = v_row.id;
    RAISE EXCEPTION 'Already linked';
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_link_code(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.redeem_link_code(text) FROM anon;
