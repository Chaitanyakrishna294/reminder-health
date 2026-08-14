/**
 * THE RETRY LADDER — how many times the device re-asks before it gives up and
 * leaves the sticky missed notice.
 *
 * Between the first ring and the caregiver being told, there is a gap where the
 * honest thing to do is simply ask again. Someone put the phone down, or was in
 * the shower, or genuinely meant to and forgot in the ninety seconds since. The
 * ladder is that second, third and fourth ask.
 *
 * THIS FILE COMPUTES OFFSETS. IT DOES NOT SCHEDULE ANYTHING. Fire times come
 * only from the Kotlin alarm core, per the one-clock doctrine — the same rule
 * that keeps `calculateNextReminder` honest across the bot and the web. What
 * lives here is the arithmetic both sides must agree on, and `retry-ladder-
 * vectors.json` is the fixture that proves they do.
 *
 * THE 30-MINUTE CAP IS THE WHOLE SAFETY ARGUMENT. `scan_and_escalate_overdue_
 * reminders` clamps its escalation anchor to `created_at + 30 minutes`, and that
 * clamp exists so a dose nobody re-prompted still escalates. If a ladder could
 * run past it, the patient would be politely re-asked at +35 while their
 * daughter was already being told they had missed it — the app contradicting
 * itself across two phones. So `interval × count` may never exceed 30, and the
 * scheduler's most-feared function is never edited to accommodate us.
 */

export type PriorityLevel = 'normal' | 'important' | 'critical';

export interface RetryConfig {
  /** Minutes between rungs. */
  interval: number;
  /** How many times to re-ask. */
  count: number;
}

/**
 * The hard ceiling on `interval × count`, in minutes. See the note above — this
 * number is load-bearing, not a preference.
 */
export const RETRY_CAP_MINUTES = 30;

/**
 * Defaults per priority. Routine gets ONE nudge because a missed vitamin is not
 * an event; critical gets five because that is the case the whole feature is
 * for, and 5 × 5 = 25 leaves headroom under the cap.
 */
export const DEFAULT_LADDERS: Record<PriorityLevel, RetryConfig> = {
  normal: { interval: 15, count: 1 },
  important: { interval: 10, count: 2 },
  critical: { interval: 5, count: 5 },
};

/**
 * Which priorities expose the controls. Routine is deliberately fixed: offering
 * a supplement its own retry schedule is a setting nobody needs and one more
 * decision on a form that already asks plenty.
 */
export const CONFIGURABLE_PRIORITIES: PriorityLevel[] = ['critical', 'important'];

export function isConfigurable(priority: string | null | undefined): boolean {
  return CONFIGURABLE_PRIORITIES.includes(normalisePriority(priority));
}

/** Unknown or missing priority falls to `normal`, matching `priorityMeta`. */
export function normalisePriority(level: string | null | undefined): PriorityLevel {
  const key = (level || '').toLowerCase();
  return key === 'critical' || key === 'important' ? key : 'normal';
}

/**
 * The minute offsets from the dose's scheduled time at which the device re-asks.
 *
 * `[5, 10, 15, 20, 25]` for a default critical medication. An empty array is a
 * legitimate answer — it means "ring once and then leave the sticky" — and the
 * caller must handle it rather than assuming at least one rung.
 *
 * Stored config that violates the cap is IGNORED in favour of the priority
 * default, not clamped. A row can only get out of range through a direct
 * database edit or a future cap change, and silently shortening someone's
 * critical ladder to fit is a worse failure than falling back to a known-good
 * one.
 */
export function retryOffsets(
  priority: string | null | undefined,
  config?: Partial<RetryConfig> | null,
): number[] {
  const level = normalisePriority(priority);
  const fallback = DEFAULT_LADDERS[level];

  const interval = config?.interval ?? fallback.interval;
  const count = config?.count ?? fallback.count;

  const chosen = ladderError(interval, count) === null
    ? { interval, count }
    : fallback;

  return Array.from({ length: chosen.count }, (_, i) => (i + 1) * chosen.interval);
}

/**
 * Why this interval/count pair is not allowed, or null when it is.
 *
 * Returns COPY, not a code: this is what the edit form shows, and the rules are
 * simple enough that a message naming the actual limit beats an error catalogue.
 * Zero-blame — it states the ceiling and what the current pair adds up to.
 */
export function ladderError(interval: number, count: number): string | null {
  if (!Number.isInteger(interval) || !Number.isInteger(count)) {
    return 'Use whole minutes.';
  }
  if (interval < 1 || count < 1) {
    return 'Use at least 1 minute and 1 reminder.';
  }
  const total = interval * count;
  if (total > RETRY_CAP_MINUTES) {
    return `That comes to ${total} minutes. Reminders can carry on for up to ${RETRY_CAP_MINUTES} minutes after the dose is due.`;
  }
  return null;
}

/**
 * How long the device keeps asking, in minutes from the scheduled time.
 *
 * This is the WINDOW the server's escalation must not pre-empt. It is the last
 * offset, not the cap — a medication with two rungs ten minutes apart is done at
 * 20, and there is no reason to make its caregiver wait until 30.
 */
export function retryWindowMinutes(
  priority: string | null | undefined,
  config?: Partial<RetryConfig> | null,
): number {
  const offsets = retryOffsets(priority, config);
  return offsets.length === 0 ? 0 : offsets[offsets.length - 1];
}

/**
 * The rungs still to come after the dose is answered at `resolvedAtMinute`.
 *
 * Resolving cancels the chain, from any surface — the notification action, the
 * app, or a caregiver on the web. Expressed as a pure function so the fixture
 * can assert it and the Kotlin side can test the same cases; the actual
 * cancellation is `AlarmManager.cancel` on each pending rung.
 *
 * An offline device keeps climbing until it learns, which is correct: the only
 * alternative is staying quiet about a dose it has no reason to believe was
 * taken.
 */
export function remainingOffsets(offsets: number[], resolvedAtMinute: number): number[] {
  return offsets.filter((o) => o > resolvedAtMinute);
}
