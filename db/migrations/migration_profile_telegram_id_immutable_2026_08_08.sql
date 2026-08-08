-- Batch B — make profiles.telegram_chat_id client-immutable (audit #2 / C1). CAREFUL: test the
-- link-account flows after applying (see validation file).
--
-- THE HOLE: the profiles UPDATE policy is WITH CHECK (auth.uid() = id) with no column guard, so
-- an authenticated user can PATCH their OWN row's telegram_chat_id to any value. Ownership of
-- medications/reminder_events/reminder_logs keys off
--   telegram_id IN (SELECT telegram_chat_id FROM profiles WHERE id = auth.uid())
-- so setting it to a Telegram-only patient's numeric id (no conflicting web profile -> the UNIQUE
-- constraint does not fire) hands the attacker full read/write/delete of that patient's data,
-- bypassing the entire hashed link-code system.
--
-- THE FIX: a BEFORE UPDATE trigger that blocks client-originated changes to telegram_chat_id.
-- It must NOT break the two legitimate writers:
--   1. redeem_link_code() — SECURITY DEFINER, runs as the function OWNER, so current_user is the
--      owner role (not 'authenticated'/'anon'); allowed.
--   2. the "skip Telegram" path (web/src/app/link-account/page.tsx) — a client write that sets
--      telegram_chat_id to the caller's OWN synthetic id 'WEB-<own uuid>'; allowed explicitly.
--   3. the Render bot (service_role) — current_user='service_role'; allowed.
-- Everything else from a client role is rejected.

CREATE OR REPLACE FUNCTION public.guard_profile_telegram_chat_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only police writes coming DIRECTLY from the PostgREST client roles. SECURITY DEFINER RPCs
  -- (redeem_link_code) execute as the function owner, and the bot uses service_role — both have
  -- a current_user outside this set and are trusted to rebind identity.
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.telegram_chat_id IS DISTINCT FROM OLD.telegram_chat_id THEN
      -- The one legitimate client change: self-healing to your OWN synthetic web id (the
      -- "skip Telegram linking" path). NEW.id is the caller's own id (RLS pins auth.uid()=id),
      -- so this can only ever be the caller's own 'WEB-<uuid>' — never a victim's id.
      IF NEW.telegram_chat_id IS DISTINCT FROM ('WEB-' || NEW.id::text) THEN
        RAISE EXCEPTION
          'telegram_chat_id can only be linked via redeem_link_code (attempted client change to %)',
          NEW.telegram_chat_id
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_telegram_chat_id ON public.profiles;
CREATE TRIGGER trg_guard_profile_telegram_chat_id
  BEFORE UPDATE OF telegram_chat_id ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_telegram_chat_id();
