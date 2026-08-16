'use client';

/**
 * Settings → Water. Setup for the opt-in hydration nudges.
 *
 * ## The line that matters most on this page
 *
 * "If you have heart or kidney conditions or take fluid pills, ask your doctor
 * about your water goal." It is not a footnote and it is not behind a
 * disclosure: for someone on a fluid restriction, a cheerful app telling them to
 * drink ten glasses is the one genuinely unsafe thing this feature could do.
 *
 * Everything else follows from CLAUDE.md's standing rule — the app never
 * recommends, adjusts or interprets. The goal is described as a common rule of
 * thumb, shown as a SUGGESTION, editable, and the whole feature is off until
 * someone switches it on.
 */

import React, { useMemo, useState } from 'react';
import { Droplets } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import {
  DEFAULT_CUP_ML,
  MAX_CUP_ML,
  MAX_GOAL_CUPS,
  MAX_WEIGHT_KG,
  MIN_CUP_ML,
  MIN_WEIGHT_KG,
  goalPhrase,
  nudgeTimes,
  suggestedGoalCups,
} from '@/lib/water/hydration';

export interface WaterSettings {
  enabled: boolean;
  weightKg: number | null;
  ageYears: number | null;
  windowStart: string;
  windowEnd: string;
  cupMl: number;
  goalCups: number;
}

export default function WaterSettingsClientView({ initial }: { initial: WaterSettings }) {
  const { isElderly } = useUiMode();
  const [s, setS] = useState<WaterSettings>(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const suggested = useMemo(
    () =>
      s.weightKg
        ? suggestedGoalCups({ weightKg: s.weightKg, ageYears: s.ageYears, cupMl: s.cupMl })
        : null,
    [s.weightKg, s.ageYears, s.cupMl],
  );

  const times = useMemo(
    () => nudgeTimes(s.windowStart, s.windowEnd, s.goalCups),
    [s.windowStart, s.windowEnd, s.goalCups],
  );

  const label = isElderly ? 'text-lg' : 'text-sm';
  const body = isElderly ? 'text-base' : 'text-xs';
  const field = `w-full rounded-2xl border border-input bg-card px-4 text-foreground font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    isElderly ? 'min-h-16 text-lg' : 'min-h-12 text-base'
  }`;

  const save = async (patch: Partial<WaterSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    setBusy(true);
    setNote(null);
    try {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      const id = userData.user?.id;
      if (!id) throw new Error('no session');
      const { error } = await supabase.from('water_settings').upsert(
        {
          user_id: id,
          enabled: next.enabled,
          weight_kg: next.weightKg,
          age_years: next.ageYears,
          window_start: next.windowStart,
          window_end: next.windowEnd,
          cup_ml: next.cupMl,
          goal_cups: next.goalCups,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
      if (error) throw error;
      setNote('Saved.');
    } catch {
      setS(s);
      setNote('Could not save that. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`max-w-2xl mx-auto ${isElderly ? 'space-y-7' : 'space-y-6'}`}>
      <header className="px-1">
        <h1 className={`font-black text-foreground tracking-tight ${isElderly ? 'text-4xl' : 'title-page'}`}>
          Water
        </h1>
        <p className={`text-muted-foreground font-semibold mt-1 text-balance ${isElderly ? 'text-base' : 'text-sm'}`}>
          A daily cup count on Today, with gentle reminders through the day.
        </p>
      </header>

      {/* THE SAFETY LINE. First, not last, and never behind a disclosure. */}
      <section
        className="rounded-3xl p-5 border"
        style={{ borderColor: 'var(--hydration)', background: 'var(--hydration-soft)' }}
      >
        <p className={`font-bold flex items-start gap-2 ${body}`} style={{ color: 'var(--hydration-ink)' }}>
          <Droplets aria-hidden className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="text-balance">
            If you have heart or kidney conditions or take fluid pills, ask your doctor
            about your water goal.
          </span>
        </p>
      </section>

      <section className="card-lift p-5 space-y-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={s.enabled}
            disabled={busy}
            onChange={(e) => save({ enabled: e.target.checked })}
            className="mt-1 w-6 h-6 shrink-0 accent-[var(--hydration)] cursor-pointer"
          />
          <span className="min-w-0">
            <span className={`block font-extrabold text-foreground ${label}`}>Track my water</span>
            <span className={`block text-muted-foreground font-semibold mt-0.5 text-balance ${body}`}>
              Adds a glass to Today. Reminders are ordinary notifications you can swipe
              away — they never take over the screen, and nothing is recorded when you
              ignore one.
            </span>
          </span>
        </label>
      </section>

      {s.enabled && (
        <>
          <section className="card-lift p-5 space-y-4">
            <p className={`font-extrabold text-foreground ${label}`}>Your goal</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="weight" className={`block font-bold text-foreground mb-1.5 ${body}`}>
                  Weight (kg)
                </label>
                <input
                  id="weight"
                  type="number"
                  inputMode="numeric"
                  min={MIN_WEIGHT_KG}
                  max={MAX_WEIGHT_KG}
                  value={s.weightKg ?? ''}
                  disabled={busy}
                  onChange={(e) => setS({ ...s, weightKg: e.target.value ? Number(e.target.value) : null })}
                  onBlur={() => save({})}
                  className={field}
                />
              </div>
              <div>
                <label htmlFor="age" className={`block font-bold text-foreground mb-1.5 ${body}`}>
                  Age
                </label>
                <input
                  id="age"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={120}
                  value={s.ageYears ?? ''}
                  disabled={busy}
                  onChange={(e) => setS({ ...s, ageYears: e.target.value ? Number(e.target.value) : null })}
                  onBlur={() => save({})}
                  className={field}
                />
              </div>
            </div>

            <div>
              <label htmlFor="cup" className={`block font-bold text-foreground mb-1.5 ${body}`}>
                Cup size (ml)
              </label>
              <input
                id="cup"
                type="number"
                inputMode="numeric"
                min={MIN_CUP_ML}
                max={MAX_CUP_ML}
                step={50}
                value={s.cupMl}
                disabled={busy}
                onChange={(e) => setS({ ...s, cupMl: Number(e.target.value) || DEFAULT_CUP_ML })}
                onBlur={() => save({})}
                className={field}
              />
            </div>

            <div>
              <label htmlFor="goal" className={`block font-bold text-foreground mb-1.5 ${body}`}>
                Cups a day
              </label>
              <input
                id="goal"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_GOAL_CUPS}
                value={s.goalCups}
                disabled={busy}
                onChange={(e) => setS({ ...s, goalCups: Number(e.target.value) || 1 })}
                onBlur={() => save({})}
                className={field}
              />
              {/* A SUGGESTION, offered — never applied silently, and never worded
                  as a correction. The user's own number always wins. */}
              {suggested != null && suggested !== s.goalCups && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => save({ goalCups: suggested })}
                  className={`mt-2 min-h-11 inline-flex items-center rounded-lg px-2 font-semibold underline underline-offset-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${body}`}
                  style={{ color: 'var(--hydration-ink)' }}
                >
                  A common guide for {s.weightKg} kg is {goalPhrase(suggested, s.cupMl)} — use that
                </button>
              )}
              <p className={`text-muted-foreground font-semibold mt-1.5 text-balance ${body}`}>
                This is a general guide, not advice about you. Change it to whatever suits
                you.
              </p>
            </div>
          </section>

          <section className="card-lift p-5 space-y-4">
            <p className={`font-extrabold text-foreground ${label}`}>When to remind you</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="from" className={`block font-bold text-foreground mb-1.5 ${body}`}>
                  From
                </label>
                <input
                  id="from"
                  type="time"
                  value={s.windowStart}
                  disabled={busy}
                  onChange={(e) => save({ windowStart: e.target.value })}
                  className={field}
                />
              </div>
              <div>
                <label htmlFor="to" className={`block font-bold text-foreground mb-1.5 ${body}`}>
                  To
                </label>
                <input
                  id="to"
                  type="time"
                  value={s.windowEnd}
                  disabled={busy}
                  onChange={(e) => save({ windowEnd: e.target.value })}
                  className={field}
                />
              </div>
            </div>

            <p className={`text-muted-foreground font-semibold text-balance ${body}`}>
              {times.length > 0
                ? `About ${times.length} ${times.length === 1 ? 'reminder' : 'reminders'}: ${times.join(' · ')}.`
                : 'Set a window and a goal to see when reminders would arrive.'}
            </p>
            <p className={`text-muted-foreground font-semibold text-balance ${body}`}>
              A water reminder close to one of your medicines is skipped, so the two never
              arrive together.
            </p>
          </section>
        </>
      )}

      {note && (
        <p className={`font-bold text-muted-foreground px-1 ${body}`} role="status">
          {note}
        </p>
      )}
    </div>
  );
}
