-- RE-MIND-eЯ: persist the elderly view lock on the profile. 2026-08-13.
-- Idempotent — safe to re-run in the Supabase SQL Editor.
-- ============================================================================
--
-- WHAT IT IS. A daughter sets up her mother's phone in elderly mode and turns on
-- "Lock this view". After that the mode control disappears from every bar in the app
-- and the mode can only change from Settings. It exists because the failure it
-- prevents is silent and frightening: one stray tap on a round icon in the top bar
-- and the text is suddenly small, the layout is unfamiliar, and the person holding
-- the phone has no idea what they did or how to undo it.
--
-- WHY ON THE PROFILE and not localStorage: it is a caregiver's decision about
-- someone else's device, and it has to survive a reinstall, a cleared browser, and a
-- new phone — the exact moments when the person least able to re-find the setting is
-- the one holding it. Same reasoning as every other preference that syncs.
--
-- DEFAULT FALSE, so this changes nothing for anyone who does not opt in.
--
-- NO NEW RLS POLICY. `profiles` already has an own-row UPDATE policy; this column
-- rides it. Worth stating because the instinct on seeing a new column is to add one,
-- and a second overlapping policy on profiles is how the caregiver dual-read
-- happened.
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ui_mode_locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.ui_mode_locked IS
  'Elderly view lock. When true the app shows no mode control outside Settings, so '
  'the view cannot be changed by accident. Set and cleared ONLY from Settings — see '
  'the anti-jail rule in CLAUDE.md: the lock must never lock out Settings itself.';
