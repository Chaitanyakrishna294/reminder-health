

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { resolveReminderEvent, correctReminderEvent } from '@/lib/reminder-events';
import { isPendingStatus } from '@/lib/schedule/dose-attention';
import { useUiMode } from '@/context/ui-mode-context';
import { Check, SkipForward, AlertCircle, Clock, AlertTriangle, Pill, CheckCircle, XCircle, X } from 'lucide-react';
import { PremiumToast } from '@/components/ui/premium-toast';
import { getSeverityTheme, getToneTheme } from '@/lib/severity-theme';
import { TONE_VAR, priorityMeta, doseTone, doseLabel } from '@/lib/design/semantics';
import { Badge } from '@/components/ui/badge';

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
}

// 270° SVG Severity Arc surrounding the timeline status badge
const SeverityArcBadge = React.memo(({ priority, status }: { priority: string; status: string }) => {
  // This arc used to paint routine doses BLUE, while the wizard showed them green, the
  // medication list showed them pink and the planner legend showed them pink again —
  // four answers for one priority. One lookup now.
  const color = TONE_VAR[priorityMeta(priority).tone];
  const tone = doseTone(status);

  const radius = 20;
  const strokeWidth = 3;
  const circumference = 2 * Math.PI * radius;
  const arcLength = circumference * 0.75; // 270 degrees

  return (
    <div className="relative w-16 h-16 flex items-center justify-center shrink-0">
      <svg className="absolute inset-0 w-full h-full rotate-[135deg]" viewBox="0 0 64 64">
        {/* Track circle (270 degrees) */}
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcLength} ${circumference - arcLength}`}
          strokeLinecap="round"
        />
        {/* Colored priority arc */}
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcLength} ${circumference - arcLength}`}
          strokeLinecap="round"
        />
      </svg>
      {/* Inner Status Icon */}
      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${getToneTheme(tone).tile}`}>
        {status === 'TAKEN' || status === 'RESOLVED_BY_CG' ? (
          <Check className="w-5 h-5" />
        ) : status === 'SKIPPED' ? (
          <SkipForward className="w-5 h-5" />
        ) : status === 'MISSED' || status === 'ESCALATED_TO_CG' ? (
          <AlertCircle className="w-5 h-5" />
        ) : (
          <Clock className="w-5 h-5" />
        )}
      </div>
    </div>
  );
});
SeverityArcBadge.displayName = 'SeverityArcBadge';

export default function TodaysSchedule({
  events: initialEvents,
  userRole,
  currentUserTelegramChatId,
  patientTelegramChatId,
  onEventsChange,
}: TodaysScheduleProps) {
  const [events, setEvents] = useState<ReminderEvent[]>(initialEvents);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; title: string; message: string; type: 'success' | 'error' }[]>([]);
  
  useEffect(() => {
    setMounted(true);
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

  // Correct a same-day dose that was logged wrong (Taken ↔ Skipped). Stock auto-compensates.
  const handleCorrect = async (event: ReminderEvent, currentStatus: 'TAKEN' | 'SKIPPED') => {
    if (updatingId !== null) return;
    const newAction: 'TAKEN' | 'SKIP' = currentStatus === 'TAKEN' ? 'SKIP' : 'TAKEN';
    const label = newAction === 'TAKEN' ? 'Taken' : 'Skipped';
    if (!window.confirm(`Change this dose to "${label}"?`)) return;
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
      if (message.includes('CORRECTION_WINDOW_EXPIRED')) {
        showToast('Cannot change', 'Doses can only be corrected on the same day.', 'error');
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
        onClick={() => handleCorrect(event, isTaken ? 'TAKEN' : 'SKIPPED')}
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

  if (isElderly) {
    const completedEvents = events.filter(e => ['TAKEN', 'RESOLVED_BY_CG', 'SKIPPED', 'MISSED'].includes(e.reminder_status));
    return (
      <>
        <div className="space-y-6">
          {completedEvents.length === 0 ? (
            <div className="p-12 text-center text-xl font-extrabold text-muted-foreground bg-card border-2 border-dashed border-border rounded-2xl flex flex-col items-center gap-4">
              <CheckCircle className="w-16 h-16 text-success" />
              No completed medications today yet.
            </div>
          ) : (
            completedEvents.map((event) => {
              const timeStr = mounted
                ? new Date(event.scheduled_for).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '--:--';
              const isPending = isPendingState(event.reminder_status);
              const isUpdating = updatingId === event.id;
              const isEscalated = event.reminder_status === 'ESCALATED_TO_CG';
  
              const canResolve =
                viewMode === 'PATIENT_MONITOR'
                  ? false
                  : userRole === 'PATIENT'
                    ? isPending
                    : isEscalated;
  
              return (
                // Same slanted-edge treatment as the compact card and the compliance
                // timeline tiles. These cards are tall, and skewX widens the visual
                // footprint by height/2 * tan(6deg) on each side, so `mx-3` buys back
                // the room instead of pushing the 375px viewport into overflow.
                <div
                  key={event.id}
                  className={`mx-3 p-8 rounded-3xl border-4 shadow-md bg-card flex flex-col transition-none [transform:skewX(-6deg)] ${
                    isEscalated
                      ? 'border-danger bg-danger/5'
                      : isPending
                        ? 'border-primary'
                        : 'border-border opacity-70'
                  }`}
                >
                  <div className="flex flex-col gap-6 [transform:skewX(6deg)]">
                  <div className="flex items-start gap-4">
                    <Pill className="w-16 h-16 text-primary shrink-0" />
                    <div className="space-y-3 flex-1">
                      <h3 className="text-3xl sm:text-4xl font-black text-foreground leading-none">
                        {event.medications.drug_name}
                        {event.medications.dosage && (
                          <span className="font-bold text-muted-foreground text-2xl ml-2">
                            ({event.medications.dosage})
                          </span>
                        )}
                      </h3>
                      <div className="flex flex-wrap items-center gap-4 mt-2">
                        <span className="text-xl sm:text-2xl font-extrabold text-primary bg-primary/10 px-4 py-1.5 rounded-xl border border-primary/20 flex items-center gap-1.5" suppressHydrationWarning>
                          <Clock className="w-5 h-5" /> {timeStr}
                        </span>
                        <span className={`text-sm uppercase font-extrabold px-3 py-1.5 rounded-full border-2 ${
                          event.medications.priority_level === 'critical'
                            ? 'bg-danger/10 border-danger/30 text-danger'
                            : 'bg-muted border-border text-muted-foreground'
                        }`}>
                          Priority: {event.medications.priority_level}
                        </span>
                        <div className="text-lg font-black flex flex-col items-start gap-1">
                          {getStatusBadge(event.reminder_status)}
                          {renderChangeLink(event)}
                        </div>
                      </div>
                    </div>
                  </div>
  
                  {canResolve && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                      <button
                        onClick={() => handleResolve(event, 'TAKEN')}
                        disabled={isUpdating}
                        className="w-full h-[88px] flex items-center justify-center text-2xl sm:text-3xl font-black rounded-2xl bg-success text-success-foreground hover:bg-success/90 disabled:opacity-50 transition-none cursor-pointer shadow-lg active:scale-95"
                      >
                        {isUpdating ? 'Updating...' : userRole === 'CAREGIVER' ? 'Confirm Taken' : 'I TOOK IT'}
                      </button>
                      <button
                        onClick={() => handleResolve(event, 'SKIP')}
                        disabled={isUpdating}
                        className="w-full h-[88px] flex items-center justify-center text-2xl sm:text-3xl font-black rounded-2xl bg-warning text-warning-foreground hover:bg-warning/90 disabled:opacity-50 transition-none cursor-pointer shadow-lg active:scale-95"
                      >
                        {isUpdating ? 'Updating...' : userRole === 'CAREGIVER' ? 'Confirm Skip' : 'SKIP IT'}
                      </button>
                    </div>
                  )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Toast Notifications */}
        <PremiumToast toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
      </>
    );
  }

  // Reusable render helper for medication capsule card
  const renderCard = (event: ReminderEvent, idx: number) => {
    const timeStr = mounted
      ? new Date(event.scheduled_for).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : '--:--';
    const isPending = isPendingState(event.reminder_status);
    const isUpdating = updatingId === event.id;
    const isEscalated = event.reminder_status === 'ESCALATED_TO_CG';
    const canResolve = 
      viewMode === 'PATIENT_MONITOR' 
        ? false 
        : userRole === 'PATIENT' 
          ? isPending 
          : isEscalated;

    // Severity colour: red = critical, amber = important, green = normal.
    const priority = event.medications.priority_level;
    const sevColor = priority === 'critical' ? 'text-danger bg-danger/15' : priority === 'important' ? 'text-warning bg-warning/15' : 'text-success bg-success/15';
    const status = event.reminder_status;
    const statusIcon =
      status === 'TAKEN' || status === 'RESOLVED_BY_CG' ? <Check className="w-5 h-5" />
      : status === 'SKIPPED' ? <SkipForward className="w-5 h-5" />
      : status === 'MISSED' || status === 'ESCALATED_TO_CG' ? <AlertCircle className="w-5 h-5" />
      : <Clock className="w-5 h-5" />;
    const theme = getSeverityTheme(priority);
    const borderClass = isEscalated
      ? 'border-danger/30 bg-danger/5'
      : isPending
        ? `${theme.bg} ${theme.border}`
        : `${theme.bg} border-border/40 opacity-90`;

    return (
      // Slanted left/right edges, flat top/bottom — same treatment as the Daily
      // Compliance Timeline tiles: skew the card, counter-skew the contents so the
      // name, time and buttons stay upright. clip-path would give the same silhouette
      // but throws the rounded corners away, so it's a transform on both layers.
      <div
        key={event.id}
        className={`rounded-2xl border px-5 py-3 flex shadow-sm hover:shadow-md transition-all duration-200 [transform:skewX(-6deg)] ${borderClass}`}
      >
      <div className="flex flex-1 min-w-0 items-center justify-between gap-3 [transform:skewX(6deg)]">
        {/* Severity dot, then name over time.
            Name and time used to sit side by side on one line with the action buttons,
            which left the NAME 56px on a 375px screen — "TEST Med A" needs 84px, so the
            one thing the row exists to identify was the thing being cut off. Stacking
            them gives the name the full column. */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span
            className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${sevColor}`}
            title={`${priority} priority, ${status.replace(/_/g, ' ').toLowerCase()}`}
            aria-label={`${priority} priority, ${status.replace(/_/g, ' ').toLowerCase()}`}
          >
            {statusIcon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-foreground text-sm truncate">{event.medications.drug_name}</p>
            <p className="text-xs text-muted-foreground font-semibold tabular-nums" suppressHydrationWarning>
              {timeStr}
            </p>
          </div>
        </div>

        {/* Resolve toggle — small icon + word */}
        <div className="shrink-0">
          {canResolve ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleResolve(event, 'TAKEN')}
                disabled={isUpdating}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-full bg-success/15 text-success border border-success/30 hover:bg-success/25 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
              >
                {isUpdating ? '…' : (<><Check className="w-3.5 h-3.5" /> Take</>)}
              </button>
              <button
                onClick={() => handleResolve(event, 'SKIP')}
                disabled={isUpdating}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-full bg-muted text-muted-foreground border border-border hover:bg-muted/70 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
              >
                {isUpdating ? '…' : (<><SkipForward className="w-3.5 h-3.5" /> Skip</>)}
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-end gap-0.5">
              {getStatusBadge(event.reminder_status)}
              {renderChangeLink(event)}
            </div>
          )}
        </div>
      </div>
      </div>
    );
  };

  const completedEvents = events.filter(e => ['TAKEN', 'RESOLVED_BY_CG', 'SKIPPED', 'MISSED'].includes(e.reminder_status));
  const firstThree = completedEvents.slice(0, 3);
  const remaining = completedEvents.slice(3);

  return (
    <>
      <div className="space-y-6">
        {completedEvents.length === 0 ? (
          /* bg-white/40 had no dark variant, and the compat rule only matches a bare
             `.bg-white`, so in dark mode this composited to a pale grey-blue panel
             carrying muted-foreground text at roughly 1.6:1. */
          <div className="p-8 text-center text-sm text-muted-foreground bg-card/60 rounded-3xl border border-dashed border-border/80">
            No completed medication events today yet.
          </div>
        ) : (
          <>
            <div className="space-y-6">
              {firstThree.map((event, idx) => renderCard(event, idx))}
            </div>
  
            {remaining.length > 0 && (
              <>
                <div className={`${isExpanded ? 'block' : 'hidden md:block'} space-y-6`}>
                  {remaining.map((event, idx) => renderCard(event, idx + 3))}
                </div>
  
                <button 
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="w-full md:hidden py-4 px-4 border border-primary/20 rounded-[24px] text-sm font-black text-foreground bg-primary/5 hover:bg-primary/10 active:scale-[0.97] transition-all select-none cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                >
                  {isExpanded ? 'Hide Remaining Schedule' : `Show Remaining Schedule (${remaining.length} more)`}
                </button>
              </>
            )}
          </>
        )}
      </div>

      {/* Toast Notifications */}
      <PremiumToast toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </>
  );
}
