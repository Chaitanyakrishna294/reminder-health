import React from 'react';
import { redirect } from 'next/navigation';
import { resolveUserData } from '@/lib/supabase/cached-queries';
import { createClient } from '@/lib/supabase/server';
import {
  DEFAULT_CUP_ML,
  DEFAULT_WINDOW_END,
  DEFAULT_WINDOW_START,
} from '@/lib/water/hydration';
import WaterSettingsClientView, { type WaterSettings } from './water-settings-client-view';

export const revalidate = 0;

/**
 * Settings → Water.
 *
 * ORDERING NOTE — this page tolerates the migration not being applied yet.
 * PostgREST fails an entire select on a table it does not know, so the read is
 * wrapped and falls back to the defaults with the feature OFF. Deploying before
 * the migration therefore costs the setup screen its saved values, not the
 * Settings section.
 */
export default async function WaterSettingsPage() {
  const userData = await resolveUserData();
  if (!userData) redirect('/login');

  const supabase = await createClient();
  let settings: WaterSettings = {
    enabled: false,
    weightKg: null,
    ageYears: null,
    windowStart: DEFAULT_WINDOW_START,
    windowEnd: DEFAULT_WINDOW_END,
    cupMl: DEFAULT_CUP_ML,
    goalCups: 8,
  };

  try {
    const { data } = await supabase
      .from('water_settings')
      .select('enabled, weight_kg, age_years, window_start, window_end, cup_ml, goal_cups')
      .eq('user_id', userData.user.id)
      .maybeSingle();
    if (data) {
      settings = {
        enabled: !!data.enabled,
        weightKg: data.weight_kg ?? null,
        ageYears: data.age_years ?? null,
        // Postgres `time` comes back as "08:00:00"; the form wants "08:00".
        windowStart: String(data.window_start ?? DEFAULT_WINDOW_START).slice(0, 5),
        windowEnd: String(data.window_end ?? DEFAULT_WINDOW_END).slice(0, 5),
        cupMl: data.cup_ml ?? DEFAULT_CUP_ML,
        goalCups: data.goal_cups ?? 8,
      };
    }
  } catch {
    // Table not there yet — the defaults above stand, with the feature off.
  }

  return <WaterSettingsClientView initial={settings} />;
}
