// Shared scheduling primitives for the web app.
//
// The dashboard's "virtual dose" generator (dashboard-client-view.tsx) and the
// Schedule Planner (schedule-planner/page.tsx) both expand a medication's
// `reminder_times` for a given day and apply the user's per-day overrides. That
// shared shape used to be copy-pasted in both; the divergence is what let the two
// drift (e.g. the planner gained frequency awareness that the dashboard never had).
//
// These helpers are the single source of truth for the parts that are genuinely
// identical between the two callers — the override lookup, its type, and the
// frequency-recurrence rule. Each caller still owns its own output shape and
// timezone handling, so wiring them up here is behavior-preserving.

/** A user-saved, per-day adjustment to a medication's schedule. */
export interface OverrideEntry {
  medicationId: number;
  dateStr: string; // YYYY-MM-DD (UTC date, via Date#toISOString)
  overriddenTime?: string; // HH:MM the dose was shifted to
  isSkipped?: boolean; // dose skipped for this day
}

/** The YYYY-MM-DD key both callers use to match overrides (UTC date). */
export function toOverrideDateStr(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Find the override (if any) a user saved for this medication on this day.
 * Identical lookup previously inlined in both the dashboard and the planner.
 */
export function findOverride(
  overrides: OverrideEntry[],
  medicationId: number,
  dateStr: string,
): OverrideEntry | undefined {
  return overrides.find(
    (o) => o.medicationId === medicationId && o.dateStr === dateStr,
  );
}

/**
 * Parse an HH:MM (optionally with am/pm) time string to minutes-since-midnight,
 * or null if unparseable. Extracted from the planner for reuse/sorting.
 */
export function parseTimeToMinutes(t: string): number | null {
  if (!t) return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
