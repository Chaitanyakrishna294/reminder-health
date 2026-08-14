// Single source of truth for which dose statuses are "pending" (normal path)
// vs "attention" (missed backlog that must be surfaced), and for the med-due
// gate's question order. Consumed by the gate queue, the top-of-dashboard
// missed strip, and the hero-card selection so all three surfaces agree.
// Structural typing on purpose: works for any event shape with these keys.

export interface DoseLike {
  id: number;
  scheduled_for: string;
  reminder_status: string;
}

/** A dose that slipped past the user and needs an explicit answer. */
export const ATTENTION_STATUSES: readonly string[] = ['MISSED', 'PENDING_REVIEW', 'UNCONFIRMED'];

/** A dose still on its normal path: scheduled, or fired but not yet resolved. */
export const PENDING_STATUSES: readonly string[] = [
  // Client-side virtual / legacy states
  'PENDING_PATIENT', 'RETRYING_PATIENT', 'SNOOZED', 'ESCALATED_TO_CG', 'FUTURE_SCHEDULED',
  // Real reminder_events statuses for a fired-but-unresolved dose
  'SENT', 'DISPLAYED', 'OPENED', 'GENTLE_REMINDER', 'REMINDED', 'RETRYING',
  'ESCALATED', 'CAREGIVER_ACKNOWLEDGED',
];

/**
 * A dose in the live caregiver-escalation stage: the scheduler alerted the
 * caregiver (ESCALATED) and they may have acknowledged (CAREGIVER_ACKNOWLEDGED),
 * but the dose is still unresolved. Subset of PENDING_STATUSES (plus the legacy
 * pre-5.7B name) — an orthogonal severity flavor for escalation badges/alarms.
 */
export const ESCALATION_STATUSES: readonly string[] = [
  'ESCALATED', 'CAREGIVER_ACKNOWLEDGED', 'ESCALATED_TO_CG',
];

export const isAttentionStatus = (status: string): boolean => ATTENTION_STATUSES.includes(status);
export const isPendingStatus = (status: string): boolean => PENDING_STATUSES.includes(status);
export const isEscalatedStatus = (status: string): boolean => ESCALATION_STATUSES.includes(status);

/**
 * Split events into the missed backlog and the normal pending set, each
 * ascending by scheduled time. Resolved doses (TAKEN/SKIPPED/…) land in neither.
 */
export function partitionDoseAttention<T extends DoseLike>(
  events: T[],
): { attention: T[]; pending: T[] } {
  const byTimeAsc = (a: T, b: T) =>
    new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime();
  return {
    attention: events.filter(e => isAttentionStatus(e.reminder_status)).sort(byTimeAsc),
    pending: events.filter(e => isPendingStatus(e.reminder_status)).sort(byTimeAsc),
  };
}

/**
 * The gate's question queue: due-now pending doses first (the dose the user
 * most likely opened the app for), THEN the missed backlog, oldest first.
 * Snoozing ("ask me later") suppresses a dose here only – never in the strip.
 */
export function buildGateQueue<T extends DoseLike>(
  events: T[],
  nowMs: number,
  snoozedUntil: Record<number, number>,
): T[] {
  const { attention, pending } = partitionDoseAttention(events);
  const dueNow = pending.filter(e => new Date(e.scheduled_for).getTime() <= nowMs);
  return [...dueNow, ...attention].filter(
    e => !(snoozedUntil[e.id] && nowMs < snoozedUntil[e.id]),
  );
}

/**
 * The doses that share the EARLIEST outstanding instant.
 *
 * The gate and the rail both call this, so "which doses are the ones right now"
 * has exactly one definition. A noon handful is one handful: asking about it a
 * pill at a time means the second question arrives after the person has already
 * swallowed all four, and they answer it from memory.
 *
 * Earliest-first still governs ACROSS instants — an unanswered 08:00 dose still
 * outranks a 14:00 one. What changed on 2026-08-14 is that "earliest" stopped
 * meaning "exactly one": a 4-medication device test found two fighting for the
 * full screen while two sat as notifications, because the old rule was built on
 * there being a single earliest and four doses at 08:00 have none.
 *
 * Returns [] for an empty queue, so callers can render nothing without a guard.
 */
export function earliestDoseGroup<T extends DoseLike>(queue: T[]): T[] {
  if (queue.length === 0) return [];
  const times = queue.map((e) => new Date(e.scheduled_for).getTime());
  const earliest = Math.min(...times);
  // Exact equality on the instant, deliberately. Two doses a minute apart are
  // two separate asks; only a genuinely simultaneous set is one handful.
  return queue.filter((e, i) => times[i] === earliest);
}
