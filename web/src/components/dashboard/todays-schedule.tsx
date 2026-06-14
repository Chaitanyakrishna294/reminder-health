

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { resolveReminderEvent } from '@/lib/reminder-events';
import { useUiMode } from '@/context/ui-mode-context';
import { Check, SkipForward, AlertCircle, Clock, AlertTriangle, Pill, CheckCircle, XCircle, X } from 'lucide-react';
import { PremiumToast } from '@/components/ui/premium-toast';
import { getSeverityTheme } from '@/lib/severity-theme';

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
  let color = '#4F8EF7'; // Normal = Blue
  if (priority === 'critical') color = '#ff3b30'; // Critical = Red
  else if (priority === 'important') color = '#ff9500'; // Important = Amber

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
          stroke="#E2E8F0"
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
      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
        status === 'TAKEN' || status === 'RESOLVED_BY_CG'
          ? 'bg-success/10 text-success'
          : status === 'SKIPPED'
            ? 'bg-warning/10 text-warning'
            : status === 'MISSED' || status === 'ESCALATED_TO_CG'
              ? 'bg-danger/10 text-danger'
              : 'bg-primary/10 text-primary'
      }`}>
        {status === 'TAKEN' || status === 'RESOLVED_BY_CG' ? (
          <Check className="w-5 h-5" />
        ) : status === 'SKIPPED' ? (
          <SkipForward className="w-5 h-5" />
        ) : status === 'MISSED' || status === 'ESCALATED_TO_CG' ? (
          <AlertCircle className="w-5 h-5 text-danger" />
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

  const getStatusBadge = (status: string) => {
    const sizeClasses = isElderly 
      ? "px-4 py-1.5 text-lg rounded-xl border-2" 
      : "px-2 py-0.5 text-xs rounded-full";
    switch (status) {
      case 'TAKEN':
      case 'RESOLVED_BY_CG':
        return (
          <span className={`inline-flex items-center font-bold bg-success/15 text-success border-success/35 ${sizeClasses}`}>
            <Check className="w-3 h-3 mr-1" /> Taken
          </span>
        );
      case 'SKIPPED':
        return (
          <span className={`inline-flex items-center font-bold bg-warning/15 text-warning border-warning/35 ${sizeClasses}`}>
            <SkipForward className="w-3 h-3 mr-1" /> Skipped
          </span>
        );
      case 'MISSED':
        return (
          <span className={`inline-flex items-center font-bold bg-danger/15 text-danger border-danger/35 ${sizeClasses}`}>
            <XCircle className="w-3 h-3 mr-1" /> Missed
          </span>
        );
      case 'SNOOZED':
        return (
          <span className={`inline-flex items-center font-bold bg-primary/10 text-primary border-primary/25 ${sizeClasses}`}>
            <Clock className="w-3 h-3 mr-1" /> Snoozed
          </span>
        );
      case 'ESCALATED_TO_CG':
        return (
          <span className={`inline-flex items-center font-bold bg-danger/15 text-danger animate-pulse border-danger/35 ${sizeClasses}`}>
            <AlertTriangle className="w-3 h-3 mr-1" /> Escalated
          </span>
        );
      default:
        return (
          <span className={`inline-flex items-center font-bold bg-muted text-muted-foreground border-muted/20 ${sizeClasses}`}>
            <Clock className="w-3 h-3 mr-1" /> Pending
          </span>
        );
    }
  };

  const isPendingState = (status: string) => {
    return [
      // Client-side virtual / legacy states
      'PENDING_PATIENT', 'RETRYING_PATIENT', 'SNOOZED', 'ESCALATED_TO_CG', 'FUTURE_SCHEDULED',
      // Real reminder_events statuses for a fired-but-unresolved dose, so each due dose keeps
      // its own Take/Skip here (this is where the patient resolves doses individually —
      // e.g. take 2 of 5 and skip the other 3).
      'SENT', 'DISPLAYED', 'OPENED', 'GENTLE_REMINDER', 'REMINDED', 'RETRYING',
      'ESCALATED', 'CAREGIVER_ACKNOWLEDGED',
    ].includes(status);
  };

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
                <div 
                  key={event.id} 
                  className={`p-8 rounded-3xl border-4 shadow-md bg-card flex flex-col gap-6 transition-none ${
                    isEscalated 
                      ? 'border-danger bg-danger/5' 
                      : isPending 
                        ? 'border-primary' 
                        : 'border-border opacity-70'
                  }`}
                >
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
                        <div className="text-lg font-black">
                          {getStatusBadge(event.reminder_status)}
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

    // Severity-tinted capsule; escalated overrides everything with danger emphasis.
    const theme = getSeverityTheme(event.medications.priority_level);
    const borderClass = isEscalated
      ? 'border-danger/30 bg-danger/5 shadow-sm shadow-danger/10'
      : isPending
        ? `${theme.bg} ${theme.border} hover:border-primary/40`
        : `${theme.bg} border-border/40 opacity-90`;

    return (
      <div
        key={event.id}
        className={`rounded-3xl min-h-[120px] border p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-sm hover:shadow-md transition-all duration-300 ${borderClass}`}
      >
        <div className="flex items-center gap-5">
          {/* Visual Status Circle Indicator surrounded by Severity Arc */}
          <SeverityArcBadge priority={event.medications.priority_level} status={event.reminder_status} />
          
          <div className="space-y-1">
            <h4 className="text-xl font-bold text-[#0F172A] tracking-tight">
              {event.medications.drug_name}
              {event.medications.dosage && (
                <span className="font-semibold text-[#475569] text-sm ml-2">
                  ({event.medications.dosage})
                </span>
              )}
            </h4>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <span className="text-xs text-primary font-bold bg-primary/10 px-2 py-0.5 rounded-lg border border-primary/20 flex items-center gap-1" suppressHydrationWarning>
                <Clock className="w-3.5 h-3.5" /> {timeStr}
              </span>
              <span className="text-[10px] uppercase font-extrabold px-2 py-0.5 bg-muted rounded-md text-muted-foreground border border-border">
                {event.medications.priority_level} Priority
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 self-end md:self-center shrink-0">
          {canResolve ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleResolve(event, 'TAKEN')}
                disabled={isUpdating}
                className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-black rounded-full bg-success/20 backdrop-blur-md border border-success/40 text-success hover:bg-success/30 active:scale-[0.96] transition-all cursor-pointer shadow-sm disabled:opacity-50"
              >
                {isUpdating ? '...' : (<><Check className="w-4 h-4" /> <span>{userRole === 'CAREGIVER' ? 'Confirm Taken' : 'Take Now'}</span></>)}
              </button>
              <button
                onClick={() => handleResolve(event, 'SKIP')}
                disabled={isUpdating}
                className="inline-flex items-center gap-1.5 px-4 py-3 text-sm font-bold rounded-full bg-white/55 backdrop-blur-md border border-white/70 text-muted-foreground hover:bg-white/80 active:scale-[0.96] transition-all cursor-pointer shadow-sm disabled:opacity-50"
              >
                {isUpdating ? '...' : (<><X className="w-4 h-4" /> <span>Skip</span></>)}
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-end gap-1">
              {getStatusBadge(event.reminder_status)}
            </div>
          )}
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
          <div className="p-8 text-center text-sm text-muted-foreground bg-white/40 rounded-3xl border border-dashed border-border/80">
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
                  className="w-full md:hidden py-4 px-4 border border-primary/20 rounded-[24px] text-sm font-black text-primary bg-primary/5 hover:bg-primary/10 active:scale-[0.97] transition-all select-none cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
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
