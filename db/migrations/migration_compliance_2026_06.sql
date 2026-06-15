-- RE-MIND-eЯ Compliance & Abuse-Prevention Migration (2026-06)
-- Adds: GDPR account deletion (hard delete) + Postgres-backed rate limiting.
-- Idempotent — safe to re-run in the Supabase SQL Editor.
-- ============================================================================


-- ============================================================================
-- 1. GDPR "right to erasure": delete ALL of the calling user's data.
-- ----------------------------------------------------------------------------
-- Runs as the authenticated caller (uses auth.uid()). Deletes every app-table
-- row keyed to the user, plus their Health Vault storage objects, then the
-- profile row. The auth.users row itself is removed by the API route via the
-- service client (supabase.auth.admin.deleteUser) AFTER this returns.
-- Order respects likely FK dependencies (children before parents).
-- ============================================================================
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

  -- Health Vault storage objects uploaded by this user.
  DELETE FROM storage.objects WHERE bucket_id = 'health-vault' AND owner = v_uid;

  -- Finally the profile itself.
  DELETE FROM public.profiles WHERE id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;


-- ============================================================================
-- 2. Rate limiting (fixed-window counter in Postgres).
-- ----------------------------------------------------------------------------
-- No new infra — uses the DB you already have. check_rate_limit() atomically
-- increments a per-key/per-window counter and returns false once the cap is
-- exceeded. Swap to Upstash/Redis later by re-implementing the JS helper only.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.rate_limits (
  bucket_key   text NOT NULL,
  window_start timestamptz NOT NULL,
  count        int NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key            text,
  p_max            int,
  p_window_seconds int
)
RETURNS boolean   -- true = allowed, false = over the limit
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window timestamptz;
  v_count  int;
BEGIN
  -- Bucket now() into a fixed window of p_window_seconds.
  v_window := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  INSERT INTO public.rate_limits AS rl (bucket_key, window_start, count)
  VALUES (p_key, v_window, 1)
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET count = rl.count + 1
  RETURNING count INTO v_count;

  RETURN v_count <= p_max;
END;
$$;

REVOKE ALL ON FUNCTION public.check_rate_limit(text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, int, int) TO authenticated, anon, service_role;

-- Hourly cleanup of stale rate-limit windows.
CREATE OR REPLACE FUNCTION public.cleanup_rate_limits()
RETURNS void AS $$
BEGIN
  DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 day';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('cleanup-rate-limits-job')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-rate-limits-job');

SELECT cron.schedule('cleanup-rate-limits-job', '30 * * * *', 'SELECT public.cleanup_rate_limits()');
