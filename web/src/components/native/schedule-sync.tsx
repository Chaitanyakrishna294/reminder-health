'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { isNativeApp, syncScheduleToNative, type MedicationPayload } from '@/lib/native/schedule-bridge';

const MEDICATION_COLUMNS =
  'id, drug_name, dosage, dosage_amount, unit_type, reminder_times, dose_days, timezone, next_reminder_at, active, medication_reason';

/**
 * Renders nothing. Mounted once in the dashboard layout so every dashboard
 * page load pushes the current medication list into the native schedule
 * store (android-app/BRIDGE_CONTRACT.md's syncSchedule) — a no-op outside
 * the Capacitor app. RLS already scopes the query to the signed-in user's
 * own medications (same policy every other medication read on this site
 * relies on), so no extra filtering is needed here.
 */
export default function ScheduleSync() {
  useEffect(() => {
    if (!isNativeApp()) return;

    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase.from('medications').select(MEDICATION_COLUMNS);

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
        await syncScheduleToNative(medications);
      } catch (err) {
        console.error('[ScheduleSync] syncSchedule failed:', err);
      }
    })();
  }, []);

  return null;
}
