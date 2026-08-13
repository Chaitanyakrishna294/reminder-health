'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  isNativeApp,
  setNativeSession,
  syncScheduleToNative,
  type MedicationPayload,
} from '@/lib/native/schedule-bridge';

const MEDICATION_COLUMNS =
  'id, drug_name, dosage, dosage_amount, unit_type, reminder_times, dose_days, timezone, next_reminder_at, active, medication_reason';

/**
 * Renders nothing. Pushes the current medication list into the native schedule
 * store (android-app/BRIDGE_CONTRACT.md's `syncSchedule`) — a no-op outside the
 * Capacitor app. RLS already scopes the query to the signed-in user's own
 * medications (the same policy every other medication read on this site relies
 * on), so no extra filtering is needed here. Guests included: the guest
 * write-guards cover only care circle and health vault, so a guest's own
 * medications sync and alarm exactly like a registered user's.
 *
 * Re-syncs on **pathname change** and on **app foreground**, not just on mount.
 * Mount alone was a real bug: this component lives in the (dashboard) layout,
 * which stays mounted across client-side navigations, so adding a medication
 * and navigating back never re-ran the sync — the new dose reached the alarm
 * store only after a full app restart. Pathname covers create/edit/delete
 * (all of which navigate); visibility covers a change made on another device
 * while the app sat in the background.
 *
 * Cheap enough to do on navigation: one indexed select of a handful of rows,
 * and the native side replaces its store wholesale anyway.
 */
export default function ScheduleSync() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;

    const sync = async () => {
      const supabase = createClient();

      // Session FIRST. It is what lets native call resolve_reminder_event /
      // snooze_reminder_event for any Taken/Skip/Snooze queued while offline, so
      // handing it over is also what drains that queue. Doing it before the
      // medication fetch means a returning user's pending actions sync on the
      // very first render rather than waiting for the next one.
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (session?.access_token && url && anonKey) {
        try {
          const result = await setNativeSession({
            accessToken: session.access_token,
            refreshToken: session.refresh_token ?? '',
            // Supabase reports expires_at in epoch SECONDS.
            expiresAt: session.expires_at ?? 0,
            supabaseUrl: url,
            supabaseAnonKey: anonKey,
            userId: session.user.id,
          });
          if (result && result.syncedPendingActions > 0) {
            console.log(`[ScheduleSync] synced ${result.syncedPendingActions} queued dose action(s)`);
            /**
             * THE SERVER JUST CHANGED UNDER US, so re-read it.
             *
             * Handing over the session is what drains the native queue, and the
             * queue is full of doses answered from the notification shade while
             * this webview was closed or backgrounded. Without this refresh the
             * page keeps showing them as due: the patient answered on the
             * notification, opens the app, and is asked the same question again —
             * and answering it a second time used to produce a red error toast
             * (fixed in todays-schedule.tsx) for a dose that was already safely
             * recorded.
             *
             * Only when something actually synced. An unconditional refresh here
             * would re-render the dashboard on every foreground and every
             * navigation, which is the calm rule's opposite.
             */
            router.refresh();
          }
        } catch (err) {
          console.error('[ScheduleSync] setSession failed:', err);
        }
      }

      if (cancelled) return;

      const { data, error } = await supabase.from('medications').select(MEDICATION_COLUMNS);

      if (cancelled) return;
      if (error) {
        console.error('[ScheduleSync] Failed to load medications:', error);
        return;
      }
      if (!data) return;

      const medications: MedicationPayload[] = data.map((row) => ({
        id: row.id,
        drugName: row.drug_name,
        dosage: row.dosage,
        dosageAmount: row.dosage_amount,
        unitType: row.unit_type,
        reminderTimes: row.reminder_times ?? [],
        doseDays: row.dose_days,
        timezone: row.timezone,
        nextReminderAt: row.next_reminder_at,
        active: row.active,
        medicationReason: row.medication_reason,
      }));

      try {
        const result = await syncScheduleToNative(medications, session?.user.id);
        if (cancelled) return;
        console.log(
          `[ScheduleSync] synced ${medications.length} medication(s) to the native store` +
            ` (exact alarms allowed: ${result?.canScheduleExactAlarms})`,
        );
      } catch (err) {
        console.error('[ScheduleSync] syncSchedule failed:', err);
      }
    };

    sync();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // `router` is intentionally not a dependency. Next's app-router instance is
    // stable, and listing it invites a future lint autofix to add something that
    // is not — which would re-subscribe the visibility listener and re-run the
    // whole sync on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}
