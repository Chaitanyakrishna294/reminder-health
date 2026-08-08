-- ROLLBACK for migration_delete_account_storage_fix_2026_08_09.sql
-- Restores the prior delete_my_account() body (the one with the direct
-- `DELETE FROM storage.objects` line). WARNING: that version is BROKEN — it fails with
-- 42501 "Direct deletion from storage tables is not allowed", so in-app account deletion
-- will not work again after this rollback. Only run this to revert; there is no good reason to.

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

  DELETE FROM public.push_tracking_tokens
   WHERE event_id IN (SELECT id FROM public.reminder_events WHERE telegram_id = v_tid);

  DELETE FROM public.push_logs          WHERE user_id = v_uid;
  DELETE FROM public.push_subscriptions WHERE user_id = v_uid;

  IF v_tid IS NOT NULL THEN
    DELETE FROM public.reminder_logs   WHERE telegram_id = v_tid;
    DELETE FROM public.reminder_events WHERE telegram_id = v_tid;
    DELETE FROM public.medications     WHERE telegram_id = v_tid;
    DELETE FROM public.link_codes      WHERE telegram_chat_id = v_tid;
    DELETE FROM public.caregiver_info  WHERE caregiver_chat_id = v_tid OR patient_telegram_id = v_tid;
  END IF;

  DELETE FROM public.notifications                  WHERE user_id = v_uid;
  DELETE FROM public.chat_messages                  WHERE sender_id = v_uid OR recipient_id = v_uid;
  DELETE FROM public.caregiver_connection_audit_logs WHERE caregiver_profile_id = v_uid OR patient_profile_id = v_uid;
  DELETE FROM public.caregiver_connections          WHERE caregiver_profile_id = v_uid OR patient_profile_id = v_uid;
  DELETE FROM public.patient_escalation_state       WHERE patient_profile_id = v_uid;
  DELETE FROM public.health_records                 WHERE user_id = v_uid;
  DELETE FROM public.health_categories              WHERE user_id = v_uid;
  DELETE FROM public.audit_logs                     WHERE user_id = v_uid;

  DELETE FROM storage.objects WHERE bucket_id = 'health-vault' AND owner = v_uid;

  DELETE FROM public.profiles WHERE id = v_uid;
END;
$$;

REVOKE ALL     ON FUNCTION public.delete_my_account() FROM PUBLIC;
GRANT EXECUTE  ON FUNCTION public.delete_my_account() TO authenticated;
