-- VALIDATION for migration_profile_telegram_id_immutable_2026_08_08.sql

-- A. The trigger + function exist.
SELECT 'trigger_present' AS check,
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_trigger
         WHERE tgname = 'trg_guard_profile_telegram_chat_id'
           AND NOT tgisinternal
       ) THEN 'OK' ELSE 'FAIL' END AS result;

-- B. FUNCTIONAL TESTS — run these from the actual app (they depend on auth.uid()/current_user,
-- which the SQL editor does not set the way PostgREST does). Expected outcomes:
--
--   1. ATTACK (must FAIL): signed in on web, call from the browser console / a REST client with
--      your own JWT:
--         PATCH /rest/v1/profiles?id=eq.<your-uuid>   body {"telegram_chat_id":"999999999"}
--      Expected: 401/403-style error "telegram_chat_id can only be linked via redeem_link_code".
--
--   2. SKIP-LINKING (must SUCCEED): a brand-new web account clicking "skip" on /link-account
--      sets telegram_chat_id = 'WEB-<own uuid>'. Expected: dashboard loads, no error.
--
--   3. REAL LINK (must SUCCEED): generate a code in the Telegram bot, redeem it on /link-account.
--      redeem_link_code runs as the definer and is exempt. Expected: link succeeds; the bot's
--      medications now appear on the web dashboard.
--
-- If test 2 or 3 fails, the definer/owner assumption for your project differs — run
-- rollback_profile_telegram_id_immutable_2026_08_08.sql and tell me; do NOT leave the link
-- flow broken.
