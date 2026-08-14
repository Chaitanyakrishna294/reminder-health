-- Resend a pending care-circle invitation (2026-08-14).
--
-- THE GAP. A patient could send an invitation and could disconnect one, but if
-- the other person simply missed the notification there was nothing to do about
-- it. "They did not see it" is the commonest real outcome of an invitation and
-- it was the one outcome with no button.
--
-- WHY A NEW RPC RATHER THAN RE-CALLING invite_caregiver FROM THE CLIENT.
-- `invite_caregiver` takes the invitee's PROFILE UUID, and the client does not
-- have it: `active_caregiver_links` exposes `caregiver_chat_id`, never
-- `caregiver_profile_id`. The two ways to close that gap were to widen the view
-- or to add this. Widening loses:
--   * `CREATE OR REPLACE VIEW` only allows APPENDING columns, so it means
--     restating a live patient-data view in full to add one field;
--   * it would hand every client a second person's profile id permanently, to
--     enable one button.
-- This takes a connection id the caller already holds and resolves the profile
-- internally, so nothing new is exposed.
--
-- AUTHORIZATION: only the PATIENT on that connection, and only while it is still
-- PENDING. Not the caregiver — a caregiver "resending" their own pending
-- invitation would be nagging someone through an app about access to that
-- person's medication history. Not once accepted — there would be nothing to
-- notify about. Not once declined — that is the answer, and re-asking is what
-- this must never become.
--
-- It writes NO new connection row. It updates `updated_at` and re-inserts the
-- notification, which is the whole point: the same request, said again.
--
-- Idempotent; safe to re-run in the Supabase SQL Editor.
-- Companion files: db/rollbacks/rollback_resend_caregiver_request_2026_08_14.sql,
--                  db/validations/validation_resend_caregiver_request_2026_08_14.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resend_caregiver_request(p_connection_id uuid)
RETURNS TABLE(resent boolean, caregiver_name text)
LANGUAGE plpgsql
SECURITY DEFINER
-- Pinned, or a caller-controlled path can point the unqualified names below at
-- their own objects.
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_conn public.caregiver_connections%ROWTYPE;
  v_patient_name text;
  v_caregiver_name text;
BEGIN
  -- Authenticate first: SECURITY DEFINER means this body runs as the owner, so
  -- the function is the only thing between a caller and the table.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT * INTO v_conn
  FROM public.caregiver_connections
  WHERE id = p_connection_id;

  IF v_conn.id IS NULL THEN
    RAISE EXCEPTION 'CONNECTION_NOT_FOUND';
  END IF;

  -- The patient owns the invitation. See the authorization note in the header.
  IF v_conn.patient_profile_id <> auth.uid() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF v_conn.connection_status <> 'PENDING' THEN
    RAISE EXCEPTION 'NOT_PENDING';
  END IF;

  SELECT full_name INTO v_patient_name FROM public.profiles WHERE id = v_conn.patient_profile_id;
  SELECT full_name INTO v_caregiver_name FROM public.profiles WHERE id = v_conn.caregiver_profile_id;

  -- Touch the row so "how long has this been waiting?" stays answerable, and so
  -- a future expiry sweep measures from the last real ask rather than the first.
  UPDATE public.caregiver_connections
  SET updated_at = now()
  WHERE id = v_conn.id;

  -- The same notification the first request produced. Written here rather than
  -- left to a trigger because no column CHANGED state — a status trigger has
  -- nothing to fire on when the answer is "still pending".
  INSERT INTO public.notifications (user_id, title, message, type, connection_id)
  VALUES (
    v_conn.caregiver_profile_id,
    'Care circle request',
    COALESCE(v_patient_name, 'Someone') || ' would still like you in their care circle.',
    'CARE_CIRCLE_ACCESS_REQUEST',
    v_conn.id
  );

  RETURN QUERY SELECT true, v_caregiver_name;
END;
$function$;

COMMENT ON FUNCTION public.resend_caregiver_request(uuid) IS
  'Re-notifies the invitee of a PENDING care-circle request. Patient-only and pending-only: a caregiver resending their own invitation would be nagging, and re-asking after a decline is what this must never become. Creates no connection row — it touches updated_at and re-inserts the request notification. Exists so the client never needs the invitee''s profile id, which active_caregiver_links deliberately does not expose.';

-- ── PRIVILEGE FOOTER — THREE revokes ────────────────────────────────────────
-- A NULL proacl means Postgres's default of EXECUTE to PUBLIC, and every role is
-- PUBLIC — including anon, the key shipped inside the APK. Supabase separately
-- runs ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO anon,
-- authenticated, service_role, which puts a DIRECT grant on all three before
-- anyone has written one.
--
-- So writing no GRANT does not mean no grant, for ANY of them. This file
-- originally revoked PUBLIC and anon and merely commented that service_role was
-- not granted; validation check 4 came back FAIL with service_role=X/postgres.
-- Fixed here and in migration_resend_revoke_service_role_2026_08_14.sql, which
-- is what to apply to a database that already ran the earlier version.
REVOKE ALL ON FUNCTION public.resend_caregiver_request(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resend_caregiver_request(uuid) FROM anon;
-- Not a leak — service_role is server-side only and bypasses RLS anyway — but
-- the bot and the cron have no reason to re-notify someone about access to
-- another person's medication history, and a footer that describes an ACL the
-- database does not have is worse than no footer.
REVOKE ALL ON FUNCTION public.resend_caregiver_request(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.resend_caregiver_request(uuid) TO authenticated;
