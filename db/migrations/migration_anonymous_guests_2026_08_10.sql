-- Anonymous guest accounts (2026-08-10) — let someone use the app with no signup,
-- then convert to a real account later WITHOUT losing anything.
--
-- How it works, and why almost nothing here is needed:
--   Supabase `signInAnonymously()` creates a normal row in auth.users with
--   `is_anonymous = true`. That means the existing AFTER INSERT trigger
--   handle_new_user() fires exactly as it does for a real signup and creates the
--   profile with `telegram_chat_id = 'WEB-' || id` plus a connect_code — it never
--   reads the email, so it needs no change. The guest gets a real `auth.uid()`,
--   so EVERY existing RLS policy applies unchanged and every medication, dose
--   log and override they create is already keyed to them.
--   Converting to a real account (updateUser({email}) + verifyOtp) keeps THE SAME
--   auth.uid(), so there is no data migration at conversion time either. Nothing
--   is copied, moved, or re-keyed. That is the whole point of the model.
--
-- So this migration exists ONLY to answer: what must a guest NOT be allowed to do?
--
-- Anonymous accounts are free and unlimited to create — no email, no
-- verification, no cost to the creator. Any write that reaches ANOTHER HUMAN or
-- consumes storage therefore becomes an abuse channel the moment guests exist:
--
--   * caregiver_connections — inserting one sends a real connection request and
--     fires a notification at a named person. Unlimited free accounts would make
--     this a spam cannon aimed at real patients and caregivers.
--   * health_records — every row is a file in a private bucket. Unlimited free
--     accounts uploading unlimited files is an unbounded storage bill on a
--     project deliberately kept on free tiers.
--
-- Everything else a guest can do (medications, reminder_events, reminder_logs,
-- schedule overrides, medical_profiles) is local to their own account, costs
-- nothing, and is exactly the product they are trying out. Those stay open.
--
-- Enforced with BEFORE INSERT triggers rather than by editing the RLS policies
-- or the SECURITY DEFINER RPCs (invite_caregiver, etc.):
--   1. Additive. No existing policy or function body is rewritten, so nothing
--      that works today can regress — the failure mode of this file is "the
--      guard does not fire", never "a real user loses access".
--   2. It catches the write no matter which path reaches the table. Gating
--      invite_caregiver alone would leave a direct client INSERT open; gating
--      the policy alone would be bypassed by the SECURITY DEFINER RPC, which
--      runs as owner and skips RLS entirely.
--   3. auth.jwt() reads the per-request `request.jwt.claims` GUC, which survives
--      into SECURITY DEFINER functions and their triggers — SECURITY DEFINER
--      changes the DB role, not the request's claims. So the guard still sees
--      the real caller inside invite_caregiver.
--
-- NOT AFFECTED (verified by the COALESCE default below):
--   * the Render worker (service_role) — its JWT carries no is_anonymous claim
--   * anything run in the Supabase SQL editor — auth.jwt() is NULL there
--   * every existing real user — is_anonymous is false/absent for them
--   Both fall through to `false` and are never blocked.
--
-- REQUIRED MANUAL STEP THIS FILE CANNOT DO: anonymous sign-ins must be turned on
-- in the Supabase dashboard (Authentication -> Sign In / Providers -> Anonymous
-- sign-ins). Until that toggle is on, signInAnonymously() returns
-- "Anonymous sign-ins are disabled" and the app simply keeps showing the normal
-- sign-in screen. Strongly consider enabling CAPTCHA protection on the same
-- screen at the same time — it is the actual rate limit on guest creation.
--
-- Idempotent; safe to re-run in the Supabase SQL Editor.
-- Companion files: db/rollbacks/rollback_anonymous_guests_2026_08_10.sql,
--                  db/validations/validation_anonymous_guests_2026_08_10.sql

BEGIN;

-- ============================================================================
-- 1. THE PREDICATE
-- ----------------------------------------------------------------------------
-- STABLE, not IMMUTABLE: it reads per-request state.
-- COALESCE(..., false) is the whole safety story — service_role, the SQL editor,
-- and every real user produce NULL or false here and are never treated as
-- guests. Only a JWT that explicitly says is_anonymous:true is.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_anonymous_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(((auth.jwt() ->> 'is_anonymous'))::boolean, false);
$$;

COMMENT ON FUNCTION public.is_anonymous_user() IS
  'True only when the current request carries a Supabase anonymous-session JWT (is_anonymous claim = true). Returns FALSE — never blocks — for service_role, for the SQL editor (auth.jwt() is NULL), and for every real signed-in user. Used by the guest write guards to keep no-signup accounts off the surfaces that reach other people or cost storage.';

REVOKE ALL ON FUNCTION public.is_anonymous_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_anonymous_user() TO authenticated, anon, service_role;

-- ============================================================================
-- 2. THE GUARD
-- ----------------------------------------------------------------------------
-- One trigger function, reused by both tables. The message is deliberately
-- readable: it surfaces through PostgREST to the client, and the UI matches on
-- the GUEST_ACCOUNT_REQUIRED code to show the "save your account" prompt rather
-- than a generic failure.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.guard_guest_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF public.is_anonymous_user() THEN
    RAISE EXCEPTION 'GUEST_ACCOUNT_REQUIRED: save your account with an email to use %', TG_TABLE_NAME
      USING HINT = 'This account is a guest (anonymous) session. Add an email to convert it — the existing data is kept.';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_guest_write() IS
  'BEFORE INSERT guard: rejects writes made from an anonymous guest session. Attached to caregiver_connections (each row messages a real person) and health_records (each row is a stored file). Deliberately NOT attached to medications/reminder_events/reminder_logs — those are local to the guest and are the product being tried out.';

DROP TRIGGER IF EXISTS guard_guest_write_caregiver_connections ON public.caregiver_connections;
CREATE TRIGGER guard_guest_write_caregiver_connections
  BEFORE INSERT ON public.caregiver_connections
  FOR EACH ROW EXECUTE FUNCTION public.guard_guest_write();

DROP TRIGGER IF EXISTS guard_guest_write_health_records ON public.health_records;
CREATE TRIGGER guard_guest_write_health_records
  BEFORE INSERT ON public.health_records
  FOR EACH ROW EXECUTE FUNCTION public.guard_guest_write();

-- ============================================================================
-- 3. NO CHANGES TO profiles, medications, OR ANY RLS POLICY — deliberately
-- ----------------------------------------------------------------------------
-- A guest's profile row is created by the untouched handle_new_user() trigger
-- and looks exactly like a web-only user's: role PATIENT, telegram_chat_id
-- 'WEB-<uuid>', a connect_code. The web proxy already routes synthetic WEB-*
-- ids straight to the dashboard instead of the Telegram link page, so guests
-- need no routing change either.
--
-- Their connect_code is generated but harmless: it only lets someone ELSE find
-- them, and the caregiver_connections guard above blocks the connection either
-- way, from both directions (the insert is the same table whoever initiates).
-- ============================================================================

NOTIFY pgrst, 'reload schema';

COMMIT;
