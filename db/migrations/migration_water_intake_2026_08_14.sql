-- RE-MIND-eЯ: water intake — an opt-in, quiet-tier feature. 2026-08-14.
-- Idempotent — safe to re-run in the Supabase SQL Editor.
-- ============================================================================
--
-- WHAT IT IS. A daily cup count with gentle nudges, OFF unless the user turns it
-- on. It is deliberately the quietest thing in the product: a normal swipeable
-- notification on its own low-importance channel, no retry ladder, no missed
-- tracking, no escalation, no streaks. A missed water day says nothing about
-- anybody, and nothing here records that it happened.
--
-- NOT MEDICAL ADVICE, AND THE APP MUST NEVER PRESENT IT AS ANY. The goal is a
-- common rule of thumb (35 ml/kg, 25 ml/kg at 65+), shown as a suggestion, fully
-- editable, and set up alongside one line telling anyone with heart or kidney
-- conditions or on fluid pills to ask their doctor. Same standing rule as
-- everywhere else in this codebase: a reminder tool, never something that
-- recommends, adjusts or interprets. See CLAUDE.md.
--
-- TWO TABLES, NOT MORE COLUMNS ON `profiles`. Seven fields of one optional
-- feature would turn the profile into a junk drawer, and `profiles` is already
-- the table CLAUDE.md warns about stacking overlapping policies on (it is how
-- the caregiver dual-read happened). Separate tables get their own tight
-- own-row policies and can be dropped whole if the feature is ever retired.
--
-- WHY THE COUNT IS A ROW PER LOCAL DAY. The widget is local-first — it paints
-- from the device instantly and works offline — and this row is what makes it
-- agree across devices. `day` is the user's LOCAL calendar day, written by the
-- client, because a cup drunk at 11pm in Kolkata belongs to that day and a UTC
-- key would move it to tomorrow for half the country's evening.
--
-- LAST WRITE WINS, on purpose. Two devices editing the same day's count is
-- resolved by `updated_at`, not by taking the larger number. "Larger wins" would
-- make undo impossible — the whole point of the swipe — by resurrecting the
-- count the user just corrected.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.water_settings (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- OFF by default. The feature must never appear for someone who did not ask.
  enabled      boolean NOT NULL DEFAULT false,
  weight_kg    smallint,
  age_years    smallint,
  window_start time NOT NULL DEFAULT '08:00',
  window_end   time NOT NULL DEFAULT '21:00',
  cup_ml       smallint NOT NULL DEFAULT 250,
  -- The user's own goal. Seeded from the suggestion, editable afterwards, which
  -- is why it is stored rather than recomputed: an edited goal must survive a
  -- birthday and a change of cup.
  goal_cups    smallint NOT NULL DEFAULT 8,
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- Rails, so a typo cannot produce a 90-cup day. Mirrored in the form and in
  -- lib/water/hydration.ts; a form check is advice, this is the limit.
  CONSTRAINT water_settings_weight_sane  CHECK (weight_kg IS NULL OR weight_kg BETWEEN 20 AND 250),
  CONSTRAINT water_settings_age_sane     CHECK (age_years IS NULL OR age_years BETWEEN 1 AND 120),
  CONSTRAINT water_settings_cup_sane     CHECK (cup_ml BETWEEN 100 AND 1000),
  CONSTRAINT water_settings_goal_sane    CHECK (goal_cups BETWEEN 1 AND 20)
);

CREATE TABLE IF NOT EXISTS public.water_logs (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The user's LOCAL calendar day. See the header.
  day        date NOT NULL,
  cups       smallint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day),
  -- Cannot go below zero (undo on an empty day) and cannot run away. The ceiling
  -- is generous on purpose: it is a rail against a stuck button, not a judgement
  -- about how much anyone drinks.
  CONSTRAINT water_logs_cups_sane CHECK (cups BETWEEN 0 AND 60)
);

ALTER TABLE public.water_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_logs     ENABLE ROW LEVEL SECURITY;

-- OWN ROW ONLY, and no caregiver read. Deliberate: this is not medication data,
-- nobody escalates on it, and a caregiver being able to see whether someone
-- drank enough water is surveillance without a purpose. If a shared view is
-- ever wanted it is a new policy with its own argument, not an oversight here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='water_settings' AND policyname='water_settings_own_row') THEN
    CREATE POLICY water_settings_own_row ON public.water_settings
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='water_logs' AND policyname='water_logs_own_row') THEN
    CREATE POLICY water_logs_own_row ON public.water_logs
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- `anon` is the key shipped inside the APK, which anyone can unpack, so it gets
-- nothing here — no policy names it, and these REVOKEs remove the table-level
-- grants Supabase's defaults would otherwise hand it.
REVOKE ALL ON public.water_settings FROM anon;
REVOKE ALL ON public.water_logs     FROM anon;

COMMENT ON TABLE public.water_settings IS
  'Opt-in hydration setup: window, cup size and daily goal. OFF by default. The '
  'goal is a rule of thumb the user can edit — the app never presents it as '
  'medical advice. See CLAUDE.md.';
COMMENT ON TABLE public.water_logs IS
  'One row per user per LOCAL calendar day holding the cup count. Local-first on '
  'the device; this row is what makes the widget agree across devices. Last write '
  'wins on updated_at — never "larger count wins", which would break undo.';
