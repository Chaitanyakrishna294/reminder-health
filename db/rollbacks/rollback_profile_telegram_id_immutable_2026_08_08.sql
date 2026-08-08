-- ROLLBACK for migration_profile_telegram_id_immutable_2026_08_08.sql
-- Removes the immutability guard. WARNING: reverting re-opens audit #2 / C1 (client can rewrite
-- their own telegram_chat_id to hijack a Telegram-only patient's data). Only run this if the
-- guard is proven to break a legitimate flow AND you have no forward fix yet.

DROP TRIGGER IF EXISTS trg_guard_profile_telegram_chat_id ON public.profiles;
DROP FUNCTION IF EXISTS public.guard_profile_telegram_chat_id();
