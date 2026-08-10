-- Rollback for migration_snooze_reminder_event_2026_08_11.sql
--
-- Drops the RPC. Safe: it only ever wrote reminder_events rows that the bot's own
-- snooze path also writes (reminder_status='SNOOZED' + retry_reminder_at +
-- snooze_count), so any rows it already touched stay valid and the scheduler's
-- existing snooze re-fire branch keeps handling them. Nothing to un-migrate.
--
-- After this, an Android snooze has no server path again: the device would defer
-- its own alarm while the server still escalates the dose to the care circle.

BEGIN;

DROP FUNCTION IF EXISTS public.snooze_reminder_event(bigint, timestamptz, integer, text);

COMMIT;
