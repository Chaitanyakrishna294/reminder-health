-- Security lockdown (2026-07-29) — closes verified client privilege-escalation holes.
-- Idempotent; safe to re-run in the Supabase SQL Editor.
--
-- Verified against current callers before writing:
--   * The Render bot and web /api/cron/tick both use service_role (bypasses RLS,
--     keeps EXECUTE via the explicit service_role grants below).
--   * The web app's only browser-side writes touched here are caregiver_info
--     self-registration + detach/accept (settings-client-view.tsx) — all still work.
--   * Browser code only SELECTs reminder_events / reminder_logs; dose mutations go
--     through the SECURITY DEFINER RPCs (resolve/correct_reminder_event), which are
--     unaffected by policy drops.
--   * caregiver_connections requests are created ONLY via the invite_caregiver RPC
--     (web settings-client-view.tsx:194, bot commands.js caregiver flow); no client
--     does a direct INSERT.
--
-- Companion files: db/rollbacks/rollback_security_lockdown_2026_07_29.sql,
--                  db/validations/validation_security_lockdown_2026_07_29.sql

BEGIN;

-- ============================================================================
-- A. Scheduler RPCs were client-callable via the default PUBLIC EXECUTE grant.
-- ----------------------------------------------------------------------------
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, and a privilege held via
-- PUBLIC cannot be revoked from an individual role — so the 2026-07 hardening's
-- "REVOKE ... FROM anon" was a no-op for these four (they never got a
-- "REVOKE ... FROM PUBLIC"; migration_5.7b_escalation_outcomes_logic.sql even
-- DROPs scan_and_escalate_overdue_reminders first, resetting any prior ACL).
-- Impact: one anon HTTP call to try_acquire_scheduler_lock with a huge TTL
-- wedges the shared `minute_tick` lease (bot AND Vercel failover), and
-- scan_and_escalate_overdue_reminders both mutates dose state and returns
-- cross-patient PHI while silently consuming escalation transitions.
-- NOTE: if any of these functions is ever redefined via DROP + CREATE, the ACL
-- resets to PUBLIC — re-run this section afterwards.
-- ============================================================================
REVOKE ALL ON FUNCTION public.try_acquire_scheduler_lock(text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_scheduler_lock(text, text)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_daily_medications()                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scan_and_escalate_overdue_reminders()           FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.try_acquire_scheduler_lock(text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_scheduler_lock(text, text)              TO service_role;
GRANT EXECUTE ON FUNCTION public.close_daily_medications()                       TO service_role;
GRANT EXECUTE ON FUNCTION public.scan_and_escalate_overdue_reminders()           TO service_role;


-- ============================================================================
-- B. caregiver_info: any authenticated user could forge an ACCEPTED caregiver
--    link to any victim (INSERT with the OR'd WITH CHECK asserting only their
--    own side; is_active defaults true, connection_status defaults 'ACCEPTED'),
--    or attach a victim to their own row via UPDATE. The legacy OR-branch in
--    the caregiver RLS dual-reads checks NO can_* permission flag, so a forged
--    row granted read of the victim's medications and read/UPDATE of their
--    reminder_events.
-- ----------------------------------------------------------------------------
-- The bot writes relationships only to caregiver_connections now (commands.js
-- explicitly deprecates the caregiver_info patient_telegram_id write as "the
-- single-link hijack vector"); its sole caregiver_info write is patient-less
-- self-registration, as is the web's (settings-client-view.tsx:308). Client
-- INSERT is therefore scoped to self-registration; client UPDATE may only
-- detach/accept, enforced field-by-field with a trigger (RLS cannot compare
-- OLD vs NEW).
-- Deviation from the audit suggestion: WITH CHECK does NOT require
-- connection_status = 'PENDING' because the column defaults to 'ACCEPTED' and
-- neither existing self-registration flow sets it — requiring PENDING would
-- break live registration. A status on a patient-less row grants nothing, and
-- the trigger prevents ever attaching a patient client-side.
-- ============================================================================
DROP POLICY IF EXISTS "Allow insert caregiver_info for own linkages" ON public.caregiver_info;
CREATE POLICY "Allow insert caregiver_info for own linkages" ON public.caregiver_info
  FOR INSERT TO authenticated
  WITH CHECK (
    caregiver_chat_id = public.get_my_telegram_chat_id()
    AND patient_telegram_id IS NULL
  );

-- USING unchanged (either side may target their own rows). The explicit WITH
-- CHECK adds the `patient_telegram_id IS NULL` arm so a PATIENT detaching
-- (patient_telegram_id -> NULL) passes: without it the implicit
-- WITH-CHECK-defaults-to-USING rejected the detached end-state (the new row
-- matches neither side), which is why the settings "disconnect caregiver"
-- legacy branch failed and revoked caregivers kept their legacy access.
DROP POLICY IF EXISTS "Allow update caregiver_info for own linkages" ON public.caregiver_info;
CREATE POLICY "Allow update caregiver_info for own linkages" ON public.caregiver_info
  FOR UPDATE TO authenticated
  USING (
    caregiver_chat_id = public.get_my_telegram_chat_id()
    OR patient_telegram_id = public.get_my_telegram_chat_id()
  )
  WITH CHECK (
    caregiver_chat_id = public.get_my_telegram_chat_id()
    OR patient_telegram_id = public.get_my_telegram_chat_id()
    OR patient_telegram_id IS NULL
  );

-- Field-level guard for client UPDATEs (service_role / internal context exempt,
-- same pattern as validate_caregiver_connection_updates).
CREATE OR REPLACE FUNCTION public.guard_caregiver_info_client_writes()
RETURNS TRIGGER AS $$
DECLARE
  caller_uid UUID := auth.uid();
  my_chat TEXT;
BEGIN
  -- Bot/service_role and internal trigger-driven updates bypass the guard.
  IF caller_uid IS NULL OR current_setting('app.cc_internal', true) = '1' THEN
    RETURN NEW;
  END IF;

  my_chat := public.get_my_telegram_chat_id();

  -- Caregiver identity is immutable for clients.
  IF NEW.caregiver_chat_id IS DISTINCT FROM OLD.caregiver_chat_id
     OR NEW.caregiver_id IS DISTINCT FROM OLD.caregiver_id THEN
    RAISE EXCEPTION 'Forbidden: caregiver identity fields are immutable';
  END IF;

  -- Clients may DETACH a patient (-> NULL) but never attach or swap one.
  IF NEW.patient_telegram_id IS DISTINCT FROM OLD.patient_telegram_id
     AND NEW.patient_telegram_id IS NOT NULL THEN
    RAISE EXCEPTION 'Forbidden: only the service role may link a patient';
  END IF;

  -- Clients may deactivate but never reactivate a link.
  IF NEW.is_active = true AND OLD.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Forbidden: clients cannot reactivate a caregiver link';
  END IF;

  -- Only the row's caregiver may move it to ACCEPTED (legacy requests are
  -- patient-initiated; acceptance is the caregiver's consent step).
  IF NEW.connection_status = 'ACCEPTED'
     AND OLD.connection_status IS DISTINCT FROM 'ACCEPTED'
     AND NEW.caregiver_chat_id IS DISTINCT FROM my_chat THEN
    RAISE EXCEPTION 'Forbidden: only the caregiver may accept a legacy link';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION public.guard_caregiver_info_client_writes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_caregiver_info_client_writes ON public.caregiver_info;
CREATE TRIGGER trg_guard_caregiver_info_client_writes
BEFORE UPDATE ON public.caregiver_info
FOR EACH ROW
EXECUTE FUNCTION public.guard_caregiver_info_client_writes();


-- ============================================================================
-- C. caregiver_connections: any authenticated user could INSERT a PENDING row
--    naming any victim as patient with attacker-chosen can_* flags and
--    is_primary (the 5.6d WITH CHECK pinned only caregiver_profile_id and
--    status), then self-accept it — validate_caregiver_connection_updates
--    allows caregiver PENDING->ACCEPTED, and respond_to_caregiver_request only
--    checks the caller is the row's caregiver, not who created the row.
-- ----------------------------------------------------------------------------
-- Every legitimate request is created by the PATIENT via the invite_caregiver
-- SECURITY DEFINER RPC (safe column defaults; web settings-client-view.tsx:194,
-- bot commands.js) — no client code direct-INSERTs this table. Dropping the
-- INSERT policy removes the only path that let a requester choose flags or
-- name themselves caregiver of an arbitrary patient; the caregiver-accepts
-- consent flow stays intact because only patient-created rows can now exist.
-- ============================================================================
DROP POLICY IF EXISTS "Caregivers can request connection" ON public.caregiver_connections;


-- ============================================================================
-- D. Revoking a modern caregiver_connections link left any mirrored legacy
--    caregiver_info row for the same pair active, so the revoked caregiver
--    kept access through the legacy OR-branch of the dual-read policies.
-- ----------------------------------------------------------------------------
-- On a genuine ACCEPTED -> revoked transition, detach the mirrored legacy link
-- (patient_telegram_id/connection_status -> NULL — same end-state the app's own
-- legacy unlink writes; deliberately NOT is_active=false, which would destroy
-- the caregiver's CG-ID registration that invite_caregiver depends on).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.deactivate_legacy_caregiver_link_on_revoke()
RETURNS TRIGGER AS $$
DECLARE
  v_cg_chat  TEXT;
  v_pat_chat TEXT;
BEGIN
  IF OLD.connection_status = 'ACCEPTED' AND OLD.is_active = true
     AND (NEW.connection_status IN ('REJECTED', 'WITHDRAWN') OR NEW.is_active = false) THEN

    SELECT telegram_chat_id INTO v_cg_chat  FROM public.profiles WHERE id = NEW.caregiver_profile_id;
    SELECT telegram_chat_id INTO v_pat_chat FROM public.profiles WHERE id = NEW.patient_profile_id;

    IF v_cg_chat IS NOT NULL AND v_pat_chat IS NOT NULL THEN
      -- Internal-bypass GUC so the caregiver_info guard trigger (section B)
      -- never blocks the mirror detach (same pattern as reassign_primary_after_revoke).
      PERFORM set_config('app.cc_internal', '1', true);
      UPDATE public.caregiver_info
      SET patient_telegram_id = NULL,
          connection_status   = NULL
      WHERE caregiver_chat_id = v_cg_chat
        AND patient_telegram_id = v_pat_chat;
      PERFORM set_config('app.cc_internal', '', true);
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.deactivate_legacy_caregiver_link_on_revoke() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_deactivate_legacy_caregiver_link_on_revoke ON public.caregiver_connections;
CREATE TRIGGER trg_deactivate_legacy_caregiver_link_on_revoke
AFTER UPDATE ON public.caregiver_connections
FOR EACH ROW
EXECUTE FUNCTION public.deactivate_legacy_caregiver_link_on_revoke();


-- ============================================================================
-- E. Client UPDATE on reminder_events / INSERT on reminder_logs were removed by
--    migration_remove_client_reminder_writes.sql (RPC-only dose ledger), then
--    resurrected by migration_5.6d_trust_center.sql and re-created last by
--    migration_remove_role_onboarding.sql (lines 500/546). Their legacy
--    OR-branch checks no can_* flag at all, and browser code only SELECTs these
--    tables — all mutations go through resolve/correct_reminder_event
--    (SECURITY DEFINER, unaffected by these drops).
-- ============================================================================
DROP POLICY IF EXISTS "Caregivers resolve patient events" ON public.reminder_events;
DROP POLICY IF EXISTS "Caregivers insert patient logs"    ON public.reminder_logs;

-- Defensive re-drops: already removed by migration_remove_client_reminder_writes.sql
-- per git history and never recreated in any migration file, but the 2026-07
-- hardening header claims "Users insert own logs" still existed live — cheap
-- no-ops if absent, real fixes if the live DB drifted from the file record.
DROP POLICY IF EXISTS "Users resolve own events"                            ON public.reminder_events;
DROP POLICY IF EXISTS "Patients resolve own events"                         ON public.reminder_events;
DROP POLICY IF EXISTS "Users insert own reminder events"                    ON public.reminder_events;
DROP POLICY IF EXISTS "Users update own reminder events"                    ON public.reminder_events;
DROP POLICY IF EXISTS "Caregivers insert patient reminder events"           ON public.reminder_events;
DROP POLICY IF EXISTS "Caregivers update accepted patient reminder events"  ON public.reminder_events;
DROP POLICY IF EXISTS "Users insert own logs"                               ON public.reminder_logs;
DROP POLICY IF EXISTS "Patients insert own logs"                            ON public.reminder_logs;

COMMIT;
