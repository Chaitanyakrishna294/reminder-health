/**
 * What a notification IS — one lookup, shared by every surface that renders one.
 *
 * The bell's old dropdown carried its own inline switch over the same eleven types.
 * That is the shape every drifted pair in this codebase started as (the priority
 * colours, the relationship labels, the two `calculateNextReminder` copies), so the
 * mapping lives here before there is a second reader rather than after.
 *
 * KIND drives where a tap goes; TONE drives the tint. Both are deliberately separate
 * from the icon: a care-circle revocation and a missed dose are different KINDS that
 * happen to share a serious tone, and collapsing the two would send one of them to
 * the wrong page.
 */

import type { Notification } from '@/hooks/use-realtime-notifications';
import type { Tone } from '@/lib/design/semantics';

export type NotificationKind = 'dose' | 'care-circle' | 'system';

export interface NotificationMeta {
  kind: NotificationKind;
  tone: Tone;
  /** Lucide icon name, resolved by the component so this module stays JSX-free. */
  icon: 'check' | 'skip' | 'missed' | 'alert' | 'heart' | 'stock' | 'bell';
}

const META: Record<string, NotificationMeta> = {
  TAKEN: { kind: 'dose', tone: 'success', icon: 'check' },
  SKIPPED: { kind: 'dose', tone: 'warning', icon: 'skip' },
  MISSED: { kind: 'dose', tone: 'danger', icon: 'missed' },
  ESCALATED: { kind: 'dose', tone: 'danger', icon: 'alert' },
  UNCONFIRMED: { kind: 'dose', tone: 'warning', icon: 'alert' },

  CARE_CIRCLE_ACCESS_REQUEST: { kind: 'care-circle', tone: 'primary', icon: 'heart' },
  CARE_CIRCLE_ACCESS_GRANTED: { kind: 'care-circle', tone: 'success', icon: 'heart' },
  CARE_CIRCLE_ACCESS_UPDATED: { kind: 'care-circle', tone: 'warning', icon: 'heart' },
  CARE_CIRCLE_ACCESS_REVOKED: { kind: 'care-circle', tone: 'danger', icon: 'heart' },
  CARE_CIRCLE_PRIMARY_CHANGED: { kind: 'care-circle', tone: 'primary', icon: 'heart' },

  LOW_STOCK: { kind: 'system', tone: 'warning', icon: 'stock' },
};

const FALLBACK: NotificationMeta = { kind: 'system', tone: 'neutral', icon: 'bell' };

/** Never throws on an unknown type: the `notifications_type_check` constraint has
 *  grown twice already, and a type this build has not heard of must still render. */
export function notificationMeta(type: Notification['type'] | string): NotificationMeta {
  return META[type] ?? FALLBACK;
}

/** Query params the dashboard reads to select and ring one dose. */
export const DOSE_MED_PARAM = 'med';
export const DOSE_AT_PARAM = 'at';

/**
 * Where tapping this notification goes — a complete href, every time.
 *
 * EVERY KIND GETS A DESTINATION. Care-circle notifications used to navigate
 * nowhere at all: a caregiver was told their access changed and left holding a
 * message with no way to act on it. A notification that cannot be acted on is a
 * worse version of no notification, because it also costs a tap to find out.
 *
 * DOSE TAPS ARE EXACT WHEN THE ROW KNOWS ITS DOSE. Since
 * migration_notification_targets_2026_08_14 the row carries `medication_id` and
 * `scheduled_for`, so the link names the day AND the dose, and the dashboard
 * scrolls that card into view and rings it — the same mechanism a dose-strip
 * pocket already drives.
 *
 * OLDER ROWS FALL BACK TO THE APPROXIMATION, deliberately. `created_at` is when
 * the ROW was written, not when the dose was due, so it is wrong across midnight
 * and wrong whenever a queued offline action synced late. It is still better
 * than refusing to navigate — and it is the honest limit of what those rows
 * know. Nothing pretends otherwise: with no medication_id there is no `med`
 * param, so the dashboard opens the day without ringing anything rather than
 * ringing the wrong card.
 *
 * @param dayKeyOf resolves a dose instant to a YYYY-MM-DD key in the right
 *   timezone. Injected rather than imported so this module stays free of the
 *   slot machinery it does not otherwise need.
 */
export function notificationTarget(
  n: Pick<Notification, 'type' | 'created_at'> & {
    medication_id?: number | null;
    scheduled_for?: string | null;
    connection_id?: string | null;
  },
  dayKeyOf: (iso: string) => string | null,
): string {
  const { kind } = notificationMeta(n.type);

  if (kind === 'care-circle') {
    // A pending request is the one care-circle notification with something to DO,
    // and its screen is not the same as the roster. The others land on the
    // roster, which is where the relationship they describe is visible.
    //
    // Per-member deep linking needs a connection → patient lookup this row does
    // not carry; it belongs with the care-circle redesign rather than as a query
    // param nothing reads.
    return n.type === 'CARE_CIRCLE_ACCESS_REQUEST' ? '/care-circle/requests' : '/care-circle';
  }

  if (kind === 'system') {
    // A stock warning is about a medication, not a dose — so it opens that
    // medication, and never carries a dose instant.
    return n.medication_id ? `/medications/${n.medication_id}` : '/medications';
  }

  // Dose.
  const instant = n.scheduled_for || n.created_at;
  const key = dayKeyOf(instant);
  if (!key) return '/dashboard';

  const params = new URLSearchParams({ day: key });
  // Both, or neither. The pair is what identifies a dose — `reminder_events` is
  // unique on exactly (medication_id, scheduled_for) — and half of it would ring
  // whichever dose of that medication happened to sort first.
  if (n.medication_id && n.scheduled_for) {
    params.set(DOSE_MED_PARAM, String(n.medication_id));
    params.set(DOSE_AT_PARAM, n.scheduled_for);
  }
  return `/dashboard?${params.toString()}`;
}
