-- RE-MIND-eЯ: how long each dose alarm rings before it gives up. 2026-08-14.
-- Idempotent — safe to re-run in the Supabase SQL Editor.
-- ============================================================================
--
-- WHAT IT IS. The native alarm screen rang for a hard-coded 60 seconds and then
-- auto-dismissed. That number was chosen when an alarm asked about exactly one dose.
-- With the coalesced ring it asks about a HANDFUL — one dose at a time, each with its
-- own ring window — so 60 seconds is now a per-dose budget, and whether it is enough
-- depends on the person holding the phone. Someone who needs two minutes to reach the
-- kitchen and read a label is not served by a number picked for someone who does not.
--
-- WHY ON THE PROFILE and not localStorage: it is a decision about a device someone
-- may not have configured themselves (a daughter setting up her mother's phone), and
-- it has to survive a reinstall and a new phone — the moments when the person least
-- able to re-find the setting is the one holding it. Same reasoning as
-- `ui_mode_locked`.
--
-- WHY IT MUST CROSS THE BRIDGE. The alarm screen is Kotlin, running with no webview
-- and often no network. It cannot read this column. `syncSchedule` carries the value
-- into `AlarmPrefs`, exactly as it already carries elderly mode — see
-- android-app/BRIDGE_CONTRACT.md §1. A device that has never synced keeps the 60s
-- default, which is the current behaviour, so nothing changes until someone chooses.
--
-- THE BOUNDS ARE THE POINT, so they are a CHECK and not just a form control.
--   * FLOOR 60s — the current value. Anything shorter is a dose alarm that gives up
--     before someone in another room can reach the phone, and the whole product is
--     built on the alarm being hard to miss.
--   * CEILING 300s (5 min) — a handful of four at 5 minutes each is a screen lit,
--     ringing and vibrating for twenty minutes. Past that it stops being a reminder
--     and becomes a battery and household problem, and the SERVER's escalation ladder
--     is already the answer for a dose nobody responds to.
-- The UI offers 1-5 minutes; this is the floor under it, because a form check is
-- advice (see the Health Vault rule in CLAUDE.md) and this value drives a wake-lit
-- screen on someone's bedside table.
--
-- DEFAULT 60, so this changes nothing for anyone who does not opt in.
--
-- NO NEW RLS POLICY. `profiles` already has an own-row UPDATE policy; this column
-- rides it. Worth stating because the instinct on seeing a new column is to add one,
-- and a second overlapping policy on profiles is how the caregiver dual-read
-- happened.
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS alarm_ring_seconds smallint NOT NULL DEFAULT 60;

-- Separate from the ADD COLUMN so a re-run does not fail on an existing constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_alarm_ring_seconds_bounds'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_alarm_ring_seconds_bounds
      CHECK (alarm_ring_seconds BETWEEN 60 AND 300);
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.alarm_ring_seconds IS
  'How long the native dose alarm rings for EACH dose before auto-advancing to the '
  'next dose in the same handful, or dismissing. 60-300s, default 60. Read by the '
  'web and carried to the device through syncSchedule (BRIDGE_CONTRACT.md) — the '
  'Kotlin alarm screen cannot read this table. A dose that rings out is left '
  'UNRESOLVED: the server escalation ladder still owns missed doses.';
