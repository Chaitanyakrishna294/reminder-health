-- Batch A — brute-force guard for redeem_link_code (audit #3 / M1).
--
-- The link-code space is ~10^6 ('RMDR-'+6 digits) with a 15-min TTL. The only rate limit
-- today lives in the Next route (web/src/app/api/link-account/redeem/route.ts), but the RPC
-- is granted to `authenticated` and reachable directly at /rest/v1/rpc/redeem_link_code, so
-- an attacker bypasses the route limit and brute-forces codes — each hit binds a victim's
-- telegram_chat_id to the attacker (full identity/PHI hijack). Fix: enforce the limit INSIDE
-- the RPC, keyed on auth.uid(), so it cannot be bypassed.
--
-- This redefinition preserves the existing body byte-for-byte and only inserts the rate-limit
-- block right after the auth check. The internal check_rate_limit() call runs as the function
-- owner (SECURITY DEFINER), so it still works after check_rate_limit is locked to service_role
-- by migration_rpc_grant_lockdown_2026_08_08.sql.

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

  -- Brute-force guard: at most 5 redemption attempts per user per 5 minutes, enforced in-DB
  -- so a direct RPC call cannot bypass the API route's IP-based limit. Counts every attempt
  -- (valid or not), which is what throttles guessing.
  IF NOT public.check_rate_limit('redeem_link_code:' || v_uid::text, 5, 300) THEN
    RAISE EXCEPTION 'Too many attempts. Please wait a few minutes and try again.';
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

  -- No DELETE here: an uncaught RAISE EXCEPTION rolls back everything this function did
  -- earlier in the SAME call, including a DELETE issued just before it — so a delete-then-
  -- raise here would silently never persist (confirmed empirically: a live acceptance test
  -- showed the row surviving despite this exact pattern). Not a security gap either way —
  -- the expires_at check below always blocks a stale code regardless of whether the row is
  -- still present. cleanup_expired_link_codes() (existing maintenance function) reaps it.
  IF v_row.expires_at < now() THEN
    RAISE EXCEPTION 'Code expired';
  END IF;

  -- telegram_chat_id is UNIQUE on profiles: if this Telegram identity is already linked to
  -- a DIFFERENT profile, the UPDATE raises unique_violation, caught below. No DELETE in the
  -- handler for the same rollback-on-raise reason as above: resubmitting the same code just
  -- hits this same unique_violation again until it naturally expires (safe, not reusable
  -- for anything else) and cleanup_expired_link_codes() reaps it then.
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
REVOKE ALL     ON FUNCTION public.redeem_link_code(text) FROM PUBLIC;
