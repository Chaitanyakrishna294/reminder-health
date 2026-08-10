'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { isNativeApp, syncScheduleToNative, type MedicationPayload } from '@/lib/native/schedule-bridge';

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

  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;

    const sync = async () => {
      const supabase = createClient();
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
        const result = await syncScheduleToNative(medications);
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
  }, [pathname]);

  return null;
}
