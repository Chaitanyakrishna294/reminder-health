/**
 * How long each dose alarm rings before the screen moves on.
 *
 * Mirrors the CHECK on `profiles.alarm_ring_seconds` and `AlarmPrefs`'s clamp in
 * Kotlin. Three copies of the same bounds is deliberate: the database is the
 * limit, the device protects itself against a bad sync, and this is what the
 * form offers. A form check is advice (see the Health Vault rule in CLAUDE.md) —
 * it is here to make the choice legible, not to be the enforcement.
 */

export const RING_SECONDS_MIN = 60;
export const RING_SECONDS_MAX = 300;
export const RING_SECONDS_DEFAULT = 60;

/** The choices the settings control offers, in seconds. */
export const RING_DURATION_CHOICES = [60, 120, 180, 240, 300] as const;

export function clampRingSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return RING_SECONDS_DEFAULT;
  return Math.min(RING_SECONDS_MAX, Math.max(RING_SECONDS_MIN, Math.round(seconds)));
}

/** "1 minute" / "3 minutes". Whole minutes only — every choice is one. */
export function ringDurationLabel(seconds: number): string {
  return minutesLabel(clampRingSeconds(seconds) / 60);
}

/**
 * Formats a duration that is NOT a per-dose setting and must not be clamped.
 *
 * Kept separate because the obvious shortcut — reusing [ringDurationLabel] —
 * silently capped the group total at the per-dose ceiling, so four medicines at
 * 3 minutes each reported "up to 5 minutes" instead of 12. The bound belongs to
 * one dose; the total is whatever it adds up to, and understating it is exactly
 * the thing this copy exists to prevent.
 */
function minutesLabel(minutes: number): string {
  const whole = Math.round(minutes);
  return whole === 1 ? '1 minute' : `${whole} minutes`;
}

/**
 * How many doses share the user's busiest reminder time.
 *
 * The number the hint needs, and the reason the hint exists: the setting is per
 * dose, the alarm screen is per handful, and 3 minutes means something different
 * to someone with one morning medicine than to someone with four.
 *
 * Grouped by `(timezone, HH:MM)` — the same pair the native
 * `DosesAtInstant.hasDoseAt` compares, so this counts the handfuls the alarm
 * screen will actually build. Paused medications are excluded because they
 * produce no alarm.
 *
 * `dose_days` is deliberately ignored. Two medicines at 08:00 on different days
 * of the week never ring together, so this can overstate — but it overstates the
 * ceiling in a sentence that already says "up to", and the alternative is
 * walking a calendar to soften a hint.
 */
export function largestHandful(
  medications: { reminderTimes: string[]; timezone: string; active: boolean }[],
): number {
  const counts = new Map<string, number>();
  for (const med of medications) {
    if (!med.active) continue;
    // A medication listing the same time twice is one dose at that time, not two.
    const times = new Set(med.reminderTimes.map((t) => t.trim()).filter(Boolean));
    for (const time of times) {
      const key = `${med.timezone}@${time}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let largest = 0;
  for (const n of counts.values()) if (n > largest) largest = n;
  return largest;
}

/**
 * THE ARITHMETIC IS SAID OUT LOUD, because the setting is per DOSE and the
 * screen it drives is per HANDFUL.
 *
 * Four medicines at 3 minutes each is a lit, ringing, vibrating phone for up to
 * twelve. Someone choosing 5 minutes for a single dose is making a reasonable
 * choice; someone choosing it with four morning medicines is making a different
 * one, and they can only tell if we say so. Only shown once there is a real
 * handful to describe — telling someone with one medicine about totals is noise.
 *
 * @param seconds the per-dose window
 * @param largestHandful how many doses share the user's busiest reminder time
 */
export function ringDurationHint(seconds: number, largestHandful: number): string {
  const each = `Each medicine rings for ${ringDurationLabel(seconds)}.`;
  if (largestHandful < 2) return each;
  const total = minutesLabel((clampRingSeconds(seconds) * largestHandful) / 60);
  return `${each} Your busiest time has ${largestHandful} medicines, so that alarm could ring for up to ${total}.`;
}
