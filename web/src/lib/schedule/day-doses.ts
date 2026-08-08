import type { SupabaseClient } from '@supabase/supabase-js';
import { type OverrideEntry, findOverride, parseTimeToMinutes, toOverrideDateStr } from './dose-engine';

/**
 * "What doses are there on this day" — shared by the Schedule Planner and the
 * Medications page.
 *
 * This lives in one place deliberately. The rule has several parts that are easy to
 * get subtly different (a past day reads from the log, a future day is projected, a
 * medication cannot be due before it existed, a deleted medication survives only
 * through its name snapshot), and two copies of it would drift the way the priority
 * colours and the relationship labels did.
 */

export interface DayDose {
  id: number;
  drug_name: string;
  dosage: string;
  frequency: string;
  time: string;
  priority_level: string;
  isOverridden?: boolean;
  overriddenTime?: string;
  isSkipped?: boolean;
  /** Set only for days in the past, from the dose log — what actually happened. */
  outcome?: 'TAKEN' | 'SKIP' | 'MISSED';
  /** When the dose was answered, as opposed to when it was due. */
  respondedAt?: string | null;
  medicationReason?: string | null;
  linkedBrandName?: string | null;
  /** The medication row is gone: only the log's name snapshot and times remain. */
  isDeleted?: boolean;
}

/** The medication fields this module needs. Callers may pass richer rows. */
export interface DoseSourceMed {
  id: number;
  drug_name: string;
  dosage: string;
  frequency: string;
  priority_level: string;
  reminder_times?: string[] | null;
  created_at?: string | null;
}

export type DoseHistory = Record<string, DayDose[]>;

/**
 * Real dose history for a date range, grouped by day.
 *
 * `drug_name_snapshot` is selected alongside the join so a dose logged against a
 * medication that has since been deleted still says WHAT was taken. The FK is
 * ON DELETE SET NULL (migration_preserve_dose_history.sql), so the log outlives the
 * medication and the join simply comes back null.
 */
export async function fetchDoseHistory(
  supabase: SupabaseClient,
  telegramId: string,
  from: Date,
  to: Date,
): Promise<DoseHistory> {
  const { data, error } = await supabase
    .from('reminder_logs')
    .select('id, response, scheduled_time, responded_at, medication_id, drug_name_snapshot, medications(drug_name, dosage, priority_level, medication_reason, linked_brand_name)')
    .eq('telegram_id', telegramId)
    .gte('scheduled_time', from.toISOString())
    .lte('scheduled_time', to.toISOString());

  // supabase-js RESOLVES on a Postgres error rather than rejecting, so this has to be
  // checked explicitly — otherwise a failed query renders as "nothing was taken",
  // which is a specific and dangerous lie in an adherence record.
  if (error) {
    console.error('[day-doses] history query failed:', error.message);
    return {};
  }

  const grouped: DoseHistory = {};
  for (const row of (data as any[]) || []) {
    const when = new Date(row.scheduled_time);
    const key = toOverrideDateStr(when);
    const joined = Array.isArray(row.medications) ? row.medications[0] : row.medications;
    (grouped[key] ||= []).push({
      id: row.medication_id ?? -row.id,
      drug_name: joined?.drug_name || row.drug_name_snapshot || 'Deleted medication',
      dosage: joined?.dosage || '',
      frequency: '',
      time: when.toTimeString().slice(0, 5),
      priority_level: joined?.priority_level || 'normal',
      outcome: row.response === 'TAKEN' ? 'TAKEN' : row.response === 'SKIP' ? 'SKIP' : 'MISSED',
      respondedAt: row.responded_at ?? null,
      medicationReason: joined?.medication_reason ?? null,
      linkedBrandName: joined?.linked_brand_name ?? null,
      isDeleted: !joined,
    });
  }
  return grouped;
}

const byTime = (a: DayDose, b: DayDose) =>
  (parseTimeToMinutes(a.time) ?? 0) - (parseTimeToMinutes(b.time) ?? 0);

/**
 * Doses for one day: the logged record for a past day, the projected schedule
 * otherwise.
 */
export function dosesForDate(
  date: Date,
  opts: {
    medications: DoseSourceMed[];
    overrides?: OverrideEntry[];
    history?: DoseHistory;
  },
): DayDose[] {
  const dateStr = toOverrideDateStr(date);
  const todayStr = toOverrideDateStr(new Date());

  // A past day is a record, not a plan. Show what was actually logged rather than
  // re-projecting today's reminder_times backwards over a day that already happened.
  if (dateStr < todayStr) {
    const logged = opts.history?.[dateStr];
    // Falling through to the projection only while history is still loading; a past
    // day that genuinely has no logs will show its projection once loaded.
    if (logged) return [...logged].sort(byTime);
  }

  // Every active medication has a dose every day: the reminder engine (src/utils.js
  // calculateNextReminder) expands `reminder_times` daily and does NOT honour
  // every_other_day/weekly, so those frequencies really do fire daily. This shows what
  // actually happens rather than a recurrence the engine never follows.
  return opts.medications
    // A medication cannot have been due before it existed. Without this, adding a
    // medication today back-projects it across the whole week, so yesterday shows
    // doses for something that was not being taken yet. Compared as day strings so the
    // cutoff follows the same day boundaries as everything else here.
    .filter((med) => !med.created_at || dateStr >= toOverrideDateStr(new Date(med.created_at)))
    .flatMap((med) =>
      (med.reminder_times || []).map((timeStr) => {
        const medOverride = opts.overrides ? findOverride(opts.overrides, med.id, dateStr) : undefined;
        return {
          id: med.id,
          drug_name: med.drug_name,
          dosage: med.dosage,
          frequency: med.frequency,
          time: medOverride?.overriddenTime || timeStr,
          priority_level: med.priority_level,
          isOverridden: !!medOverride?.overriddenTime,
          overriddenTime: medOverride?.overriddenTime,
          isSkipped: medOverride?.isSkipped || false,
        } as DayDose;
      }),
    )
    .sort(byTime)
    .filter((d, idx, arr) => arr.findIndex((x) => x.id === d.id && x.time === d.time) === idx);
}

/** The seven days of the week containing `date`, Sunday first. */
export function weekOf(date: Date): Date[] {
  const start = new Date(date);
  start.setDate(date.getDate() - date.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}
