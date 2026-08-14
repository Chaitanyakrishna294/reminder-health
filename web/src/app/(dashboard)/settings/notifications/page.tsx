import React from 'react';
import { redirect } from 'next/navigation';
import { resolveUserData } from '@/lib/supabase/cached-queries';
import { createClient } from '@/lib/supabase/server';
import { largestHandful, RING_SECONDS_DEFAULT, clampRingSeconds } from '@/lib/alarm/ring-duration';
import NotificationsClientView from './notifications-client-view';

export const revalidate = 0;

/**
 * ORDERING NOTE — this page tolerates the migration not being applied yet.
 *
 * `profiles.alarm_ring_seconds` arrives with
 * migration_alarm_ring_seconds_2026_08_14.sql, and PostgREST does not ignore a
 * column it does not know: it fails the ENTIRE select. That is why the profile
 * read below is its own query in its own try, rather than being folded into
 * anything this page needs — deploying before the migration costs the ring-
 * duration control its saved value, not the whole Notifications screen.
 *
 * The retry-ladder work took the opposite approach (hard "migration first"), and
 * it was right there: `syncSchedule` silently going stale is invisible from the
 * web. A settings control that shows its default for a few minutes is not.
 */
export default async function NotificationsSettingsPage() {
  const userData = await resolveUserData();
  if (!userData) redirect('/login');

  const supabase = await createClient();

  let ringSeconds = RING_SECONDS_DEFAULT;
  try {
    const { data } = await supabase
      .from('profiles')
      .select('alarm_ring_seconds')
      .eq('id', userData.user.id)
      .maybeSingle();
    if (data?.alarm_ring_seconds) ringSeconds = clampRingSeconds(data.alarm_ring_seconds);
  } catch {
    // Column not there yet — the control shows the default, which IS the
    // behaviour every device currently has.
  }

  // Drives the "your busiest time has N medicines" hint. RLS scopes this to the
  // signed-in user, the same policy every other medication read relies on.
  const { data: meds } = await supabase
    .from('medications')
    .select('reminder_times, timezone, active');

  const handful = largestHandful(
    (meds ?? []).map((m) => ({
      reminderTimes: m.reminder_times ?? [],
      timezone: m.timezone,
      active: m.active,
    })),
  );

  return (
    <NotificationsClientView
      telegramChatId={userData.myTelegramChatId || ''}
      ringSeconds={ringSeconds}
      largestHandful={handful}
    />
  );
}
