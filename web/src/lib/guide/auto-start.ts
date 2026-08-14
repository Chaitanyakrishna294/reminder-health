/**
 * Should a guided tour volunteer itself?
 *
 * Pulled out of the component so the rule can be read and tested on its own.
 * The bug it exists to prevent is not a rendering bug — it is the app deciding
 * a long-standing user is a beginner — and that decision is three booleans, not
 * a screen.
 */

export type AutoStartDecision =
  /** Play the tour, and record that it has now been offered. */
  | 'start'
  /**
   * Do not play, AND record that this account is established, so no tour on any
   * page volunteers itself again.
   */
  | 'suppress'
  /** Do not play. Nothing to record — this was already decided. */
  | 'skip';

export interface AutoStartInputs {
  /**
   * This account already holds medications. `undefined` means the calling page
   * cannot tell (the add-medication wizard never loads the list), which is NOT
   * the same as "no" — see `established`.
   */
  accountHasData?: boolean;
  /** A previous page on this device already concluded the account is established. */
  established: boolean;
  /** This particular tour has already been offered on this device. */
  seen: boolean;
}

/**
 * ORDER MATTERS, and it is the whole rule.
 *
 * `accountHasData` is checked FIRST, ahead of the per-tour "seen" flag, because
 * seen-ness is per device and account data is not. A returning user on a new
 * phone, after a reinstall, or with cleared storage has `seen = false` and is
 * still not a beginner — that is exactly the case the old code got wrong, and
 * checking `seen` first would preserve it.
 */
export function autoStartDecision({ accountHasData, established, seen }: AutoStartInputs): AutoStartDecision {
  if (accountHasData) return 'suppress';
  if (established || seen) return 'skip';
  return 'start';
}
