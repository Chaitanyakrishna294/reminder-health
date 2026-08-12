-- RE-MIND-eЯ: rotate every connect_code. 2026-08-13. Pre-launch hygiene.
-- ============================================================================
--
-- ** NOT IDEMPOTENT. RUN ONCE. ** Re-running issues everyone a third code and
-- invalidates the second — harmless to the database, confusing to a human who has
-- just written the new one down. This is the one file in db/migrations that is not
-- safe to re-run, so it says so at the top rather than in a footnote.
--
-- WHY. `lookup_profile_by_connect_code` was reachable by `anon` — the key shipped
-- inside the APK — with no auth check, so a code was enough to resolve a real name
-- and profile UUID. The APK never left the maintainer's hands, so actual exposure is
-- nil; rotation is cheap and this is the last moment before a closed test when it
-- costs nobody anything.
--
-- WHAT ROTATION DOES NOT BREAK — checked before writing, because "re-issue flow for
-- existing connections" turned out to be a non-problem:
--   * ESTABLISHED CONNECTIONS SURVIVE. `caregiver_connections` keys on profile
--     UUIDs; `invite_caregiver(uuid)` takes a UUID. The code is used once, to turn a
--     typed string into a UUID, and is never stored on the connection.
--   * PENDING INVITATIONS SURVIVE, for the same reason — a PENDING row already holds
--     both profile ids.
--   * The Settings screen renders `profiles.connect_code`, so every user simply sees
--     their new code next time they look. No re-issue step, no notification.
-- What DOES break is exactly what should: a code someone wrote on paper or sent in a
-- message and has not yet redeemed. That is the point of rotating.
--
-- NOT TOUCHED: `caregiver_info.caregiver_id` (the legacy CG-ID). It is a different
-- identifier on a different table, it is load-bearing for the three legacy rows the
-- 2026-08-11 audit found, and rotating it would break a live relationship to fix
-- nothing — `lookup_caregiver_by_code` reads it, but the same guard now covers it.
-- ============================================================================

DO $$
DECLARE
  r RECORD;
  v_rotated INTEGER := 0;
BEGIN
  -- Row by row, not a set-based UPDATE. `gen_connect_code()` loops until it finds a
  -- code not already in `profiles`, and inside a single statement it would be
  -- checking against the PRE-update snapshot — so two rows could be handed the same
  -- new code and the UNIQUE constraint would abort the whole rotation partway.
  FOR r IN SELECT id FROM public.profiles ORDER BY id LOOP
    UPDATE public.profiles
    SET connect_code = public.gen_connect_code()
    WHERE id = r.id;
    v_rotated := v_rotated + 1;
  END LOOP;

  RAISE NOTICE 'rotated connect_code for % profile(s)', v_rotated;
END $$;

-- Sanity, in the same transaction as the rotation so a failure rolls the lot back:
-- every profile must end up with a code, and all of them distinct.
DO $$
DECLARE
  v_total INTEGER;
  v_null INTEGER;
  v_distinct INTEGER;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE connect_code IS NULL), COUNT(DISTINCT connect_code)
  INTO v_total, v_null, v_distinct
  FROM public.profiles;

  IF v_null > 0 THEN
    RAISE EXCEPTION 'ROTATION_LEFT_NULLS: % profile(s) have no connect_code', v_null;
  END IF;
  IF v_distinct <> v_total THEN
    RAISE EXCEPTION 'ROTATION_COLLIDED: % profiles but only % distinct codes', v_total, v_distinct;
  END IF;

  RAISE NOTICE 'verified: % profiles, % distinct codes, 0 nulls', v_total, v_distinct;
END $$;
