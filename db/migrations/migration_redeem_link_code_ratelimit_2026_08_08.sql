-- Batch A — brute-force guard for redeem_link_code (audit #3 / M1).
--
-- The link-code space is ~10^6 ('RMDR-'+6 digits) with a 15-min TTL. The only rate limit today
-- lives in the Next route, but the RPC is granted to `authenticated` and reachable directly at
-- /rest/v1/rpc/redeem_link_code, so an attacker bypasses the route limit and brute-forces codes
-- (each hit binds a victim's telegram_chat_id to the attacker — full identity/PHI hijack). Fix:
-- enforce the limit INSIDE the RPC, keyed on auth.uid().
--
-- CRITICAL DESIGN NOTE (why this returns a status instead of raising):
-- check_rate_limit() does an INSERT ... ON CONFLICT to bump a per-key counter, in the SAME
-- transaction as this RPC call. The previous draft RAISEd 'Invalid code'/'Code expired'/'Already
-- linked' on the failure paths — but a top-level RAISE aborts the whole PostgREST transaction and
-- ROLLS BACK the counter INSERT, so the limiter never accumulated across guesses and the guard was
-- a total no-op. This version NEVER raises after the counter is incremented: it RETURNs a status
-- string, the transaction commits, and the counter persists. The route (link-account/redeem)
-- translates the status to the user-facing message.
--
-- Return type changes void -> text, so DROP first (CREATE OR REPLACE cannot change return type).

DROP FUNCTION IF EXISTS public.redeem_link_code(text);

CREATE FUNCTION public.redeem_link_code(p_code text)
RETURNS text   -- 'ok' | 'rate_limited' | 'invalid' | 'expired' | 'already_linked'
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
    -- Pre-increment: nothing to void, and the route already blocks this path. Safe to raise.
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Brute-force guard: at most 5 attempts per user per 5 minutes. RETURN (never RAISE) past this
  -- point so the counter INSERT commits. The internal call works after check_rate_limit is locked
  -- to service_role (migration_rpc_grant_lockdown) because this runs SECURITY DEFINER as the owner.
  IF NOT public.check_rate_limit('redeem_link_code:' || v_uid::text, 5, 300) THEN
    RETURN 'rate_limited';
  END IF;

  -- Bot always generates uppercase codes ('RMDR-' + digits); normalize the same way here so a
  -- user-pasted code with stray whitespace or lowercase still matches.
  v_hash := encode(sha256(convert_to(upper(trim(p_code)), 'UTF8')), 'hex');

  -- FOR UPDATE: without a row lock, two concurrent redemptions of the SAME code could both pass
  -- this lookup before either DELETEs it, linking one code to two profiles. Locking makes the
  -- second transaction wait, then see NOT FOUND once the first commits.
  SELECT * INTO v_row FROM public.link_codes WHERE code_hash = v_hash FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'invalid';
  END IF;

  IF v_row.expires_at < now() THEN
    RETURN 'expired';   -- leave the row for cleanup_expired_link_codes(); expiry always blocks it
  END IF;

  -- telegram_chat_id is UNIQUE on profiles: if this Telegram identity is already linked to a
  -- DIFFERENT profile, the UPDATE raises unique_violation, caught in this savepoint. The savepoint
  -- rolls back only the UPDATE/DELETE; the counter INSERT above is outside it and survives.
  BEGIN
    UPDATE public.profiles SET telegram_chat_id = v_row.telegram_chat_id WHERE id = v_uid;
    DELETE FROM public.link_codes WHERE id = v_row.id;
  EXCEPTION WHEN unique_violation THEN
    RETURN 'already_linked';
  END;

  RETURN 'ok';
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_link_code(text) TO authenticated;
REVOKE ALL     ON FUNCTION public.redeem_link_code(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.redeem_link_code(text) FROM anon;
