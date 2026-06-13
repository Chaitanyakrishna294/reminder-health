import type { SupabaseClient } from '@supabase/supabase-js';

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

  return result as ResolveReminderEventResult;
}
