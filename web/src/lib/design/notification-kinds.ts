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

/**
 * Where tapping this notification should go.
 *
 * A dose notification returns null here and the caller supplies the day — the
 * `notifications` table stores no medication_id and no scheduled_for, so the only
 * time it knows is `created_at`. See the note in the notifications page.
 */
export function notificationHref(type: Notification['type'] | string): string | null {
  const { kind } = notificationMeta(type);
  if (kind === 'care-circle') return '/care-circle';
  if (type === 'LOW_STOCK') return '/medications';
  return null;
}
