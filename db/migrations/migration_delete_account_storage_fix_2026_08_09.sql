-- Fix: delete_my_account() always failed with
--   42501: "Direct deletion from storage tables is not allowed. Use the Storage API instead."
-- Supabase blocks direct DELETE FROM storage.objects (a guard fires on the statement, even
-- with zero matching rows), so the RPC aborted and NO account could be deleted in-app.
--
-- Fix: drop the `DELETE FROM storage.objects` line here. Storage cleanup now happens in the
-- app route (web/src/app/api/account/delete/route.ts) via the service-role Storage API, which
-- is the supported path. Everything else in the function is byte-identical to
-- migration_compliance_2026_06.sql. CREATE OR REPLACE preserves the ACL; re-asserted below.

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tid text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT telegram_chat_id INTO v_tid FROM public.profiles WHERE id = v_uid;

  -- Push tracking tokens reference the user's reminder events.
  DELETE FROM public.push_tracking_tokens
   WHERE event_id IN (SELECT id FROM public.reminder_events WHERE telegram_id = v_tid);

  DELETE FROM public.push_logs          WHERE user_id = v_uid;
  DELETE FROM public.push_subscriptions WHERE user_id = v_uid;

  -- Telegram-id-keyed tables
  IF v_tid IS NOT NULL THEN
    DELETE FROM public.reminder_logs   WHERE telegram_id = v_tid;
    DELETE FROM public.reminder_events WHERE telegram_id = v_tid;
    DELETE FROM public.medications     WHERE telegram_id = v_tid;
    DELETE FROM public.link_codes      WHERE telegram_chat_id = v_tid;
    DELETE FROM public.caregiver_info  WHERE caregiver_chat_id = v_tid OR patient_telegram_id = v_tid;
  END IF;

  -- Profile-id-keyed tables
  DELETE FROM public.notifications                  WHERE user_id = v_uid;
  DELETE FROM public.chat_messages                  WHERE sender_id = v_uid OR recipient_id = v_uid;
  DELETE FROM public.caregiver_connection_audit_logs WHERE caregiver_profile_id = v_uid OR patient_profile_id = v_uid;
  DELETE FROM public.caregiver_connections          WHERE caregiver_profile_id = v_uid OR patient_profile_id = v_uid;
  DELETE FROM public.patient_escalation_state       WHERE patient_profile_id = v_uid;
  DELETE FROM public.health_records                 WHERE user_id = v_uid;
  DELETE FROM public.health_categories              WHERE user_id = v_uid;
  DELETE FROM public.audit_logs                     WHERE user_id = v_uid;

  -- NOTE: storage objects (health-vault files, avatars) are deleted by the app route via the
  -- Storage API BEFORE this runs — SQL cannot delete from storage.objects (Supabase blocks it).
  -- medical_profiles cascades on the profile delete below (user_id -> profiles(id) ON DELETE CASCADE).

  -- Finally the profile itself.
  DELETE FROM public.profiles WHERE id = v_uid;
END;
$$;

REVOKE ALL     ON FUNCTION public.delete_my_account() FROM PUBLIC;
GRANT EXECUTE  ON FUNCTION public.delete_my_account() TO authenticated;
