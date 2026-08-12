

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { resolveReminderEvent, correctReminderEvent } from '@/lib/reminder-events';
import { isPendingStatus } from '@/lib/schedule/dose-attention';
import { useUiMode } from '@/context/ui-mode-context';
import { Check, SkipForward, Clock, AlertTriangle, XCircle } from 'lucide-react';
import { PremiumToast } from '@/components/ui/premium-toast';

import { doseTone, doseLabel } from '@/lib/design/semantics';
import { Badge } from '@/components/ui/badge';
import DayRail from '@/components/dashboard/day-rail';
import BrainMascot from '@/components/dashboard/brain-mascot';

export interface ReminderEvent {
  id: number;
  medication_id: number;
  telegram_id: string;
  scheduled_for: string;
  reminder_status: string;
  snooze_count: number;
  medications: {
    drug_name: string;
    dosage: string;
    priority_level: string;
    unit_type?: string;
    dosage_amount?: number;
    medication_reason?: string;
  };
}

interface TodaysScheduleProps {
  events: ReminderEvent[];
  userRole: 'PATIENT' | 'CAREGIVER';
  currentUserTelegramChatId: string;
  patientTelegramChatId: string;
  onEventsChange?: (updatedEvents: ReminderEvent[]) => void;
  /**
   * medicationId → IANA zone, supplied by the dashboard because ReminderEvent
   * carries no timezone. The day rail slots by the MEDICATION's zone, never the
   * device's. Optional so the elderly and caregiver paths, which do not render
   * the rail yet, need no change.
   */
  medicationTimezone?: (medicationId: number) => string | null | undefined;
  /**
   * The dose selected in the blister strip above. The strip and the rail are two
   * views of the same day, so tapping a pocket has to land you on that dose's card
   * rather than leaving you to find it.
   */
  selectedEventId?: number | null;
  /**
   * The rail is showing a day that has already ended.
   *
   * A past day is an ARCHIVE, and the difference is not cosmetic:
   *  - no Taken/Skip. Those go through resolve_reminder_event, which drives
   *    escalation and the alarm state machine. Answering a dose from Tuesday must
   *    never start a ladder for Tuesday.
   *  - Change instead covers doses nobody ever answered, not just mis-logged ones.
   *    A MISSED row that was not actually missed is a false record, and the whole
   *    point of reaching back is to repair it.
   */
  isPastDay?: boolean;
  /**
   * The rail is previewing a day that has not happened. Read-only: a dose with no
   * outcome cannot be given one. Both RPCs refuse it server-side regardless —
   * `resolve_reminder_event` on its forward bound and `correct_reminder_event` with
   * CANNOT_CORRECT_FUTURE_DOSE — so hiding the actions is courtesy, not the guard.
   */
  isFutureDay?: boolean;
  /** Units left for a medication that is running low, else null. Drives the dose
   *  card's "N left" chip — the contextual replacement for Today's old inventory
   *  button. Threaded from the dashboard, which is where stock actually lives. */
  lowStockLeft?: (medicationId: number) => number | null;
}

// 270° SVG Severity Arc surrounding the timeline status badge

export default function TodaysSchedule({
  events: initialEvents,
  userRole,
  currentUserTelegramChatId,
  patientTelegramChatId,
  onEventsChange,
  medicationTimezone,
  selectedEventId,
  isPastDay = false,
  isFutureDay = false,
  lowStockLeft,
}: TodaysScheduleProps) {
  const [events, setEvents] = useState<ReminderEvent[]>(initialEvents);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [mounted, setMounted] = useState(false);
  /**
   * Clock for the rail's "due now" decision. Starts at 0 and is set on mount,
   * deliberately: the server has no idea what time it is on the user's device, so
   * deciding "due now" during SSR would hydrate a different card than it rendered.
   * Zero means nothing reads as due, which is the correct pre-hydration state.
   */
  const [nowMs, setNowMs] = useState(0);
  const [toasts, setToasts] = useState<{ id: string; title: string; message: string; type: 'success' | 'error' }[]>([]);
  
  useEffect(() => {
    // State is set from timer CALLBACKS, not synchronously in the effect body:
    // the latter is a cascading render and React's lint flags it. The 0ms timeout
    // lands in the same frame, so there is no visible delay before "due now" is
    // known — and the clock is read here rather than during render because the
    // server does not know the device's time.
    const start = setTimeout(() => {
      setMounted(true);
      setNowMs(Date.now());
    }, 0);
    // 60s tick: a dose must flip to "due now" without the user reloading.
    const tick = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => {
      clearTimeout(start);
      clearInterval(tick);
    };
  }, []);

  // Sync state with parent changes
  useEffect(() => {
    setEvents(initialEvents);
  }, [initialEvents]);

  const supabase = createClient();
  const router = useRouter();
  const { isElderly, viewMode } = useUiMode();

  const showToast = (title: string, message: string, type: 'success' | 'error' = 'success') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, title, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };



  const handleResolve = async (
    event: ReminderEvent,
    action: 'TAKEN' | 'SKIP'
  ) => {
    // 1. Double-click prevention
    if (updatingId !== null) return;
    setUpdatingId(event.id);

    try {
      const resolvedRecord = await resolveReminderEvent({
        supabase,
        eventId: event.id,
        medicationId: event.medication_id,
        scheduledFor: event.scheduled_for,
        action,
        actorRole: userRole,
      });

      if (resolvedRecord.already_resolved) {
        showToast(
          'Medication already resolved',
          'This medication was updated from another device.',
          'error'
        );
      }

      const updatedEvents = events.map((e) =>
        e.id === event.id
          ? { 
              ...e, 
              id: resolvedRecord.event_id ?? e.id,
              reminder_status: resolvedRecord.reminder_status
            }
          : e
      );
      setEvents(updatedEvents);
      if (onEventsChange) onEventsChange(updatedEvents);

      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Today Schedule] Error resolving event:', message, err);
      showToast('Error', 'Failed to update event. Please try again.', 'error');
    } finally {
      setUpdatingId(null);
    }
  };

  /**
   * Record what actually happened to a dose. Stock auto-compensates via the
   * reminder_events trigger.
   *
   * Takes the TARGET action rather than the current status: on a past day this also
   * answers a dose that was never answered at all (a MISSED row that was not really
   * missed), and "the other one" is not defined for those — there is nothing to flip.
   */
  const handleCorrect = async (event: ReminderEvent, newAction: 'TAKEN' | 'SKIP') => {
    if (updatingId !== null) return;
    const label = newAction === 'TAKEN' ? 'taken' : 'skipped';
    // Zero-blame, and specific about what it touches: this edits the record, it does
    // not send anything or change a schedule.
    if (!window.confirm(`Record this dose as ${label}?`)) return;
    setUpdatingId(event.id);
    try {
      const rec = await correctReminderEvent({
        supabase,
        eventId: event.id,
        medicationId: event.medication_id,
        scheduledFor: event.scheduled_for,
        action: newAction,
        actorRole: userRole,
      });
      const updated = events.map((e) =>
        e.id === event.id ? { ...e, id: rec.event_id ?? e.id, reminder_status: rec.reminder_status } : e
      );
      setEvents(updated);
      if (onEventsChange) onEventsChange(updated);
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Each server guard gets its own sentence. "Something went wrong" on a screen
      // where someone is trying to repair their own record is the least useful thing
      // the app could say — and these are the exact errors the widened correction
      // window can raise (migration_past_day_correction_2026_08_12.sql).
      if (message.includes('CORRECTION_WINDOW_EXPIRED')) {
        showToast('Too far back', 'Doses can be corrected for 7 days.', 'error');
      } else if (message.includes('CANNOT_CORRECT_FUTURE_DOSE')) {
        showToast('Not yet', 'This dose has not happened yet.', 'error');
      } else if (message.includes('EVENT_NOT_RESOLVED') || message.includes('EVENT_NOT_CORRECTABLE')) {
        // Reachable when the day rolled over between render and tap: the client
        // offered a past-day Change on what the server now judges by today's rule.
        showToast('Cannot change', 'This dose is no longer editable. Reload and try again.', 'error');
      } else {
        console.error('[Today Schedule] Error correcting event:', message, err);
        showToast('Error', 'Failed to change this dose. Please try again.', 'error');
      }
    } finally {
      setUpdatingId(null);
    }
  };

  // Small "Change to …" link shown under a resolved dose's badge.
  const renderChangeLink = (event: ReminderEvent) => {
    const s = event.reminder_status;
    if (!['TAKEN', 'SKIPPED', 'RESOLVED_BY_CG'].includes(s)) return null;
    const isTaken = s === 'TAKEN' || s === 'RESOLVED_BY_CG';
    return (
      <button
        onClick={() => handleCorrect(event, isTaken ? 'SKIP' : 'TAKEN')}
        disabled={updatingId === event.id}
        className="min-h-11 text-xs text-foreground/80 hover:text-primary underline font-semibold cursor-pointer disabled:opacity-50"
      >
        {updatingId === event.id ? 'Changing…' : `Change to ${isTaken ? 'Skipped' : 'Taken'}`}
      </button>
    );
  };

  // Every branch here used to emit `border-<tone>/35` with no `border` WIDTH class in
  // normal mode, so the border color was inert and the pill had no edge unless elderly
  // mode happened to add `border-2`. <Badge> owns that now, along with the tone lookup.
  const STATUS_ICON: Record<string, React.ReactNode> = {
    TAKEN: <Check className="w-3 h-3" />,
    RESOLVED_BY_CG: <Check className="w-3 h-3" />,
    SKIPPED: <SkipForward className="w-3 h-3" />,
    MISSED: <XCircle className="w-3 h-3" />,
    SNOOZED: <Clock className="w-3 h-3" />,
    ESCALATED_TO_CG: <AlertTriangle className="w-3 h-3" />,
  };

  const getStatusBadge = (status: string) => (
    <Badge
      tone={doseTone(status)}
      className={status === 'ESCALATED_TO_CG' ? 'animate-pulse' : ''}
    >
      {STATUS_ICON[status] ?? <Clock className="w-3 h-3" />}
      {status === 'ESCALATED_TO_CG' ? 'Escalated' : doseLabel(status)}
    </Badge>
  );

  // Pending vs attention is single-sourced in lib/schedule/dose-attention.ts.
  // Each pending dose keeps its own Take/Skip here (this is where the patient
  // resolves doses individually — e.g. take 2 of 5 and skip the other 3).
  const isPendingState = isPendingStatus;

  // AN ELDERLY-ONLY COMPLETED-DOSE LIST USED TO RETURN HERE.
  //
  // It showed ONLY resolved doses, in skewed cards, with I TOOK IT / SKIP IT — so
  // an elderly user could not see what was still ahead of them today, which is the
  // one question the screen exists to answer. It also never reached the day rail,
  // so date navigation, past-day correction and the slot grouping were all
  // normal-mode-only features.
  //
  // DayRail takes isElderly and sizes itself. One list, two scales.

  // Reusable render helper for medication capsule card

  // THE DAY RAIL (redesign §03). Replaces the completed-only list: the rail shows
  // the WHOLE day on one spine — taken, missed, snoozed, due now and still to come —
  // because "what happened and what's left" is one question, and it was previously
  // answered across four separate surfaces.
  //
  // Resolve guards stay here, not in the rail: who may resolve what in which view
  // mode is safety logic and must have exactly one home.
  const railCanResolve = (event: ReminderEvent) => {
    if (viewMode === 'PATIENT_MONITOR') return false;
    // A past day has no live actions. resolve_reminder_event is the live path — it
    // feeds escalation and the retry ladder — and running it for Tuesday's dose on
    // Thursday would start a ladder for a dose nobody is waiting on.
    if (isPastDay || isFutureDay) return false;
    return userRole === 'PATIENT'
      ? isPendingState(event.reminder_status)
      : event.reminder_status === 'ESCALATED_TO_CG';
  };

  // Correcting a dose logged the wrong way round. The old list rendered this link
  // in monitor mode too — the RPC would have refused, but offering an action that
  // cannot succeed is its own defect, so the read-only guard is applied here as
  // well. Same-day only; `handleCorrect` surfaces the expiry from the RPC.
  const railCanCorrect = (event: ReminderEvent) => {
    if (viewMode === 'PATIENT_MONITOR') return false;
    // Nothing to correct about a dose that has not happened.
    if (isFutureDay) return false;
    // These two lists mirror correct_reminder_event's own branches
    // (migration_past_day_correction_2026_08_12.sql). They are duplicated rather
    // than derived because the server is the authority and the client is only
    // deciding whether to OFFER the button — but they must not drift, or the app
    // shows a Change that fails the moment someone presses it.
    if (isPastDay) {
      return ['TAKEN', 'SKIPPED', 'RESOLVED_BY_CG', 'MISSED', 'PENDING_REVIEW', 'UNCONFIRMED', 'ESCALATED_TO_CG']
        .includes(event.reminder_status);
    }
    return ['TAKEN', 'SKIPPED', 'RESOLVED_BY_CG'].includes(event.reminder_status);
  };

  return (
    <>
      <div className="space-y-6">
        {events.length === 0 ? (
          /* Remi's empty-state slot. `peaceful`, not `concerned`: an empty day is not
             a problem to be alarmed about, and the calm rule says the mascot never
             escalates a non-event. One line, no call to action — there is nothing
             here for the user to do, and inventing a button would say otherwise.

             REMI IS THE CONTENT HERE, not a garnish on a sentence. An empty day is
             the one screen with nothing competing for attention, so it is where the
             character earns its place — and at 48px in a row he read as another
             list icon. Given real size and real room, the empty day stops looking
             like a failed load and starts looking like a quiet day, which is what
             it actually is. */
          <div className="px-6 py-10 flex flex-col items-center text-center gap-5 bg-card/60 rounded-3xl border border-dashed border-border/80">
            <BrainMascot size={isElderly ? 176 : 144} mood="peaceful" />
            <p className={`text-muted-foreground font-semibold text-balance ${isElderly ? 'text-lg' : 'text-base'}`}>
              {isPastDay
                /* Not "nothing scheduled": a past day with no rows means nothing was
                   ever recorded, which is a different fact and worth not overstating. */
                ? 'No doses were recorded this day.'
                : 'No doses scheduled this day.'}
            </p>
          </div>
        ) : (
          <DayRail
            events={events}
            timeZoneFor={(e) => medicationTimezone?.(e.medication_id)}
            canResolve={railCanResolve}
            onResolve={handleResolve}
            canCorrect={railCanCorrect}
            onCorrect={handleCorrect}
            isPastDay={isPastDay}
            updatingId={updatingId}
            isElderly={isElderly}
            nowMs={nowMs}
            selectedEventId={selectedEventId}
            lowStockLeft={lowStockLeft}
          />
        )}
      </div>

      {/* Toast Notifications */}
      <PremiumToast toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </>
  );
}

/**
 * The previous completed-only list, kept compiling but unreferenced while the rail
 * is verified on device. Delete once the rail passes — see CLAUDE.md build order.
 */
