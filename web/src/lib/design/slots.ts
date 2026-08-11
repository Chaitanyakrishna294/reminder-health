/**
 * Time-of-day slots — the redesign's mood layer (proposal §01, approved 2026-08-12).
 *
 * Colour carries time of day, so the interface feels different at 7am and 11pm
 * without a second art budget. This module owns the ONLY definition of where the
 * boundaries fall, because the same four buckets appear in three places: the web
 * day rail, the native alarm screen's ground tint, and any future widget. Three
 * copies of "when does evening start" is three chances to disagree.
 *
 * The tints themselves live in `globals.css` (`--slot-*`) and
 * `res/values/alarm_colors.xml` (`slot_*`). This file maps a time to a slot; it
 * does not know the hex values, so a palette change never touches this logic.
 *
 * **Slot tints are surfaces, never controls.** See the token comments for why.
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
