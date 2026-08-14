import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyNativeDoseResolved } from '@/lib/native/schedule-bridge';

export type ReminderResolveAction = 'TAKEN' | 'SKIP';
export type ReminderResolveActorRole = 'PATIENT' | 'CAREGIVER';

interface ResolveReminderEventParams {
  supabase: SupabaseClient;
  eventId: number;
  medicationId: number;
  scheduledFor: string;
  action: ReminderResolveAction;
  actorRole: ReminderResolveActorRole;
  resolutionChannel?: string;
}

export interface ResolveReminderEventResult {
  event_id: number;
  reminder_status: string;
  resolved_at: string | null;
  resolved_by: string | null;
  log_id: number | null;
  already_resolved: boolean;
}

export async function resolveReminderEvent({
  supabase,
  eventId,
  medicationId,
  scheduledFor,
  action,
  actorRole,
  resolutionChannel,
}: ResolveReminderEventParams): Promise<ResolveReminderEventResult> {
  const { data, error } = await supabase.rpc('resolve_reminder_event', {
    p_event_id: eventId > 0 ? eventId : null,
    p_medication_id: medicationId,
    p_scheduled_for: scheduledFor,
    p_action: action,
    p_actor_role: actorRole,
    p_resolution_channel: resolutionChannel || null,
  });

  if (error) {
    throw error;
  }

  const result = Array.isArray(data) ? data[0] : data;

  if (!result) {
    throw new Error('Reminder resolution returned no result.');
  }

  await tellTheDevice(medicationId, scheduledFor, action);

  return result as ResolveReminderEventResult;
}

/**
 * THE DEVICE HAS TO LEARN ABOUT ANSWERS MADE IN THE APP.
 *
 * The Android build runs its own retry ladder: chained exact alarms that re-ask
 * about an unanswered dose, cancelled the moment the device sees the answer. It
 * sees the alarm screen's buttons and the notification's buttons, because both
 * write to its local queue. It cannot see this — a resolve here goes straight to
 * Supabase and never touches native.
 *
 * That gap was live on a real device on 2026-08-14: two critical medications
 * marked skipped from the Today rail read as skipped everywhere on screen while
 * the phone kept ringing about them every five minutes. Being told you are late
 * for a dose you already dealt with is not a cosmetic bug in a medication app;
 * it teaches people to ignore the alarm.
 *
 * It lives HERE, in the one function every web surface resolves through — the
 * rail, the dose gate, elderly mode, the missed-dose strip, the review queue —
 * rather than in each of them, for the same reason the native side put its
 * cancellation inside `DoseActionQueue.record`: a surface added next month gets
 * it without knowing it exists.
 *
 * Never throws and never blocks the caller's success path. The dose is already
 * recorded on the server by the time this runs; a failure here costs at most one
 * extra ring, and `ScheduleSync` reconciles any ladder that outlives its answer
 * on the next app open. A caregiver answering from their own phone reaches the
 * device by that route only, since nothing on this device was involved at all.
 */
async function tellTheDevice(
  medicationId: number,
  scheduledFor: string,
  action: ReminderResolveAction,
): Promise<void> {
  try {
    await notifyNativeDoseResolved([{ medicationId, scheduledFor, action }]);
  } catch {
    // Deliberately swallowed — see above.
  }
}

/**
 * Correct an already-resolved dose to the other outcome (Taken ↔ Skipped),
 * same calendar day only. Stock auto-compensates via DB trigger.
 */
export async function correctReminderEvent({
  supabase,
  eventId,
  medicationId,
  scheduledFor,
  action,
  actorRole,
}: ResolveReminderEventParams): Promise<ResolveReminderEventResult> {
  const { data, error } = await supabase.rpc('correct_reminder_event', {
    p_event_id: eventId > 0 ? eventId : null,
    p_medication_id: medicationId,
    p_scheduled_for: scheduledFor,
    p_action: action,
    p_actor_role: actorRole,
  });

  if (error) {
    throw error;
  }

  const result = Array.isArray(data) ? data[0] : data;

  if (!result) {
    throw new Error('Reminder correction returned no result.');
  }

  // A correction is an answer too. The dose it corrects should have no ladder
  // left, but "should" is what the original bug ran on — and a correction to a
  // dose that somehow still has one is precisely the case where re-asking would
  // be most confusing.
  await tellTheDevice(medicationId, scheduledFor, action);

  return result as ResolveReminderEventResult;
}
