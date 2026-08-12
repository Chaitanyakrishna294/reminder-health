/**
 * WHEN A DOSE HAPPENED, in the medication's own local time — which day, and which
 * time-of-day slot within it.
 *
 * Both questions are answered here on purpose. They are the same operation: read an
 * instant through the MEDICATION's IANA zone and bucket the wall clock. Splitting
 * them across two modules would mean two copies of the Intl handling, the invalid-zone
 * fallback and the midnight edge case — and this codebase has already watched exactly
 * that kind of "lockstep" pair drift (see schedule-test-vectors.json).
 *
 * SLOTS are the redesign's mood layer (proposal §01, approved 2026-08-12): colour
 * carries time of day so the interface feels different at 7am and 11pm. The tints live
 * in `globals.css` (`--slot-*`) and `res/values/alarm_colors.xml` (`slot_*`); this file
 * maps a time to a slot and never knows the hex values, so a palette change cannot
 * touch this logic. **Slot tints are surfaces, never controls.**
 *
 * DAYS matter because the rail can now show a past day. A dose's day is its date in the
 * medication's timezone, NEVER the UTC date and never the viewer's — for IST (UTC+5:30)
 * those disagree for every dose between 00:00 and 05:29 local, which is precisely where
 * this app's 01:00-03:00 doses live. Getting it wrong files a 01:40 dose under yesterday.
 *
 * Both are covered by the same shared fixture, `test/slot-test-vectors.json`, which the
 * Kotlin alarm core must also pass when it ports either rule.
 */

export type SlotId = 'morning' | 'midday' | 'evening' | 'night';

export interface SlotMeta {
  id: SlotId;
  /** Uppercase mono eyebrow — a structural wayfinding label, not copy. */
  label: string;
  /** Tailwind colour name, from `@theme inline`. */
  token: string;
  /** First hour (inclusive) in the medication's own local time. */
  fromHour: number;
}

/**
 * Ordered, and the order is load-bearing: the rail renders slots in this
 * sequence and `slotForHour` walks it backwards.
 */
export const SLOTS: readonly SlotMeta[] = [
  { id: 'morning', label: 'MORNING', token: 'slot-morning', fromHour: 0 },
  { id: 'midday', label: 'MIDDAY', token: 'slot-midday', fromHour: 11 },
  { id: 'evening', label: 'EVENING', token: 'slot-evening', fromHour: 16 },
  { id: 'night', label: 'BEDTIME', token: 'slot-night', fromHour: 21 },
] as const;

/**
 * Morning starts at hour 0, not at 05:00, on purpose: a 03:00 dose is a real
 * thing in this app (night-shift workers, antibiotics on a strict interval) and
 * it must land in a slot rather than nowhere. Calling it "morning" is a small
 * inaccuracy; having an unslotted dose vanish from the rail would be a bug.
 */
export function slotForHour(hour: number): SlotMeta {
  for (let i = SLOTS.length - 1; i >= 0; i -= 1) {
    if (hour >= SLOTS[i].fromHour) return SLOTS[i];
  }
  return SLOTS[0];
}

/**
 * The slot a dose belongs to.
 *
 * @param scheduledFor ISO-8601 instant.
 * @param timeZone the MEDICATION's IANA zone — not the browser's. A dose set for
 *   08:00 in Asia/Kolkata is a morning dose even when the phone is in London,
 *   and getting this wrong would tint an entire day incorrectly for a travelling
 *   user. Falls back to the browser zone only when the medication has none.
 */
export function slotForDose(scheduledFor: string, timeZone?: string | null): SlotMeta {
  const date = new Date(scheduledFor);
  if (Number.isNaN(date.getTime())) return SLOTS[0];

  let hour: number;
  try {
    hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        hour: 'numeric',
        hour12: false,
        timeZone: timeZone || undefined,
      }).format(date),
    );
  } catch {
    // An invalid IANA name should tint the rail oddly, never throw inside a render.
    hour = date.getHours();
  }
  // Intl renders midnight as "24" in some locales/engines.
  if (!Number.isFinite(hour) || hour >= 24) hour = 0;

  return slotForHour(hour);
}

/**
 * Formats an instant as YYYY-MM-DD in `timeZone`. Assembled from `formatToParts`
 * rather than a locale that happens to print ISO order: locale data varies between
 * engines, and this string is a MAP KEY — a day that formats differently on the
 * server than in the webview would file a dose under a day nothing ever reads.
 * The Gregorian calendar is pinned for the same reason.
 */
function formatDayKey(date: Date, timeZone: string | undefined): string {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

/**
 * The calendar day a dose belongs to, as YYYY-MM-DD in the MEDICATION's timezone.
 *
 * This is the key the day rail groups by and the date row selects with. It is
 * deliberately NOT `toISOString().slice(0,10)` (that is the UTC date) and NOT
 * `toOverrideDateStr` (that is the VIEWER's date): a 01:40 Asia/Kolkata dose is
 * 20:10 UTC the previous day, so both of those file it under yesterday, and the
 * patient opens the app to find last night's dose missing from today.
 *
 * @returns null only when `scheduledFor` is unparseable — there is no honest day for
 *   an instant that does not exist, and inventing one would hide the dose on a day
 *   nobody looks at. Callers must decide what to do with it rather than silently drop
 *   it; `groupByDay` reports the count.
 */
export function dayKeyForDose(scheduledFor: string, timeZone?: string | null): string | null {
  const date = new Date(scheduledFor);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return formatDayKey(date, timeZone || undefined);
  } catch {
    // An invalid IANA name must degrade to the engine's zone, never throw inside a
    // render — same rule as slotForDose.
    return formatDayKey(date, undefined);
  }
}

/**
 * `count` consecutive day keys ending at (and including) `endKey`, oldest first.
 *
 * Pure calendar arithmetic on the key itself — no timezone involved, deliberately.
 * Once "today is 2026-08-13 for this patient" has been decided by `dayKeyForDose`,
 * yesterday is simply the previous calendar date; re-deriving it through a zone
 * would reintroduce the DST and midnight edges the key already resolved. The
 * midday anchor keeps day arithmetic away from any 23/25-hour day.
 */
export function dayKeysEndingAt(endKey: string, count: number): string[] {
  const [y, m, d] = endKey.split('-').map(Number);
  if (!y || !m || !d) return [];
  const anchor = Date.UTC(y, m - 1, d, 12);
  const pad = (n: number) => String(n).padStart(2, '0');
  return Array.from({ length: count }, (_, i) => {
    const dt = new Date(anchor - (count - 1 - i) * 86_400_000);
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  });
}

/**
 * HH:MM (24h) at the dose's own local wall clock.
 *
 * Same reason as the day key: `Date#toTimeString` prints the VIEWER's clock, so an
 * 08:00 Kolkata dose reads "02:30" to a browser running in UTC — and the adherence
 * record then disagrees with the time the patient was actually reminded.
 */
export function timeOfDayForDose(scheduledFor: string, timeZone?: string | null): string {
  const date = new Date(scheduledFor);
  if (Number.isNaN(date.getTime())) return '';
  const format = (tz: string | undefined) =>
    new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: tz,
    }).format(date);
  try {
    return format(timeZone || undefined);
  } catch {
    return format(undefined);
  }
}

/**
 * Groups doses by their day in each item's own timezone.
 *
 * Per-item, not one reference zone for the whole list: a patient can hold
 * medications in two zones after travelling, and bucketing all of them by the first
 * one's day boundary moves the others by hours.
 */
export function groupByDay<T>(
  items: readonly T[],
  getScheduledFor: (item: T) => string,
  getTimeZone?: (item: T) => string | null | undefined,
): { byDay: Record<string, T[]>; undated: T[] } {
  const byDay: Record<string, T[]> = {};
  const undated: T[] = [];
  for (const item of items) {
    const key = dayKeyForDose(getScheduledFor(item), getTimeZone?.(item));
    if (key === null) undated.push(item);
    else (byDay[key] ||= []).push(item);
  }
  return { byDay, undated };
}

/** Groups doses into slots, preserving order and dropping empty slots. */
export function groupBySlot<T>(
  items: readonly T[],
  getScheduledFor: (item: T) => string,
  getTimeZone?: (item: T) => string | null | undefined,
): { slot: SlotMeta; items: T[] }[] {
  const buckets = new Map<SlotId, T[]>();
  for (const item of items) {
    const slot = slotForDose(getScheduledFor(item), getTimeZone?.(item));
    const bucket = buckets.get(slot.id);
    if (bucket) bucket.push(item);
    else buckets.set(slot.id, [item]);
  }
  return SLOTS.filter((s) => buckets.has(s.id)).map((slot) => ({
    slot,
    items: buckets.get(slot.id)!,
  }));
}
