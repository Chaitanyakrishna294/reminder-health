

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import { Check, SkipForward, AlertCircle, Clock, AlertTriangle, Pill, CheckCircle, XCircle, X } from 'lucide-react';

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

  // Supabase Realtime Subscription
  useEffect(() => {
    if (!patientTelegramChatId) return;

    const channel = supabase
      .channel(`schedule-realtime-${patientTelegramChatId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'reminder_events',
          filter: `telegram_id=eq.${patientTelegramChatId}`,
        },
        async (payload: any) => {
          const updatedEvent = payload.new;
          if (!updatedEvent) return;

          setEvents((prev) => {
            const index = prev.findIndex((e) => e.id === updatedEvent.id);
            if (index === -1) return prev;
            
            const existing = prev[index];
            if (existing.reminder_status === updatedEvent.reminder_status) return prev;

            const updated = prev.map((e) =>
              e.id === updatedEvent.id
                ? {
                    ...e,
                    reminder_status: updatedEvent.reminder_status,
                    snooze_count: updatedEvent.snooze_count,
                  }
                : e
            );
            if (onEventsChange) onEventsChange(updated);
            return updated;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [patientTelegramChatId, supabase, onEventsChange]);

  const handleResolve = async (
    event: ReminderEvent,
    action: 'TAKEN' | 'SKIP'
  ) => {
    // 1. Double-click prevention
    if (updatingId !== null) return;
    setUpdatingId(event.id);

    try {
      const now = new Date();
      const scheduledTime = new Date(event.scheduled_for);
      const delayMinutes = Math.max(0, Math.floor((now.getTime() - scheduledTime.getTime()) / 60000));

      const resolvedStatus = userRole === 'CAREGIVER' ? 'RESOLVED_BY_CG' : action === 'TAKEN' ? 'TAKEN' : 'SKIPPED';
      const resolvedBy = userRole === 'CAREGIVER' ? 'CAREGIVER' : 'PATIENT';

      let data, updateErr;
      if (event.id < 0) {
        // Insert a new record since it is a virtual event
        const { data: insData, error: insErr } = await supabase
          .from('reminder_events')
          .insert([{
            medication_id: event.medication_id,
            telegram_id: event.telegram_id,
            scheduled_for: event.scheduled_for,
            reminder_status: resolvedStatus,
            resolved_at: now.toISOString(),
            resolved_by: resolvedBy,
            retry_reminder_at: null,
            retry_count: 0,
            snooze_count: 0,
          }])
          .select();
        data = insData;
        updateErr = insErr;
      } else {
        // Update the existing database record
        const { data: updData, error: updErr } = await supabase
          .from('reminder_events')
          .update({
            reminder_status: resolvedStatus,
            resolved_at: now.toISOString(),
            resolved_by: resolvedBy,
            retry_reminder_at: null,
            retry_count: 0,
          })
          .eq('id', event.id)
          .in('reminder_status', ['PENDING_PATIENT', 'RETRYING_PATIENT', 'SNOOZED', 'ESCALATED_TO_CG', 'FUTURE_SCHEDULED'])
          .select();
        data = updData;
        updateErr = updErr;
      }

      if (updateErr) throw updateErr;

      // 3. Concurrency check: If no rows updated, notify and refresh state (only for real events)
      if (!data || data.length === 0) {
        if (event.id >= 0) {
          showToast(
            'Medication already resolved',
            'This medication was marked as Taken from another device.',
            'error'
          );

          // Fetch latest version of this event to sync UI state
          const { data: latestEvents } = await supabase
            .from('reminder_events')
            .select(`
              id,
              medication_id,
              telegram_id,
              scheduled_for,
              reminder_status,
              snooze_count,
              medications:medication_id (
                drug_name,
                dosage,
                priority_level
              )
            `)
            .eq('id', event.id);

          if (latestEvents && latestEvents.length > 0) {
            const updatedEvent = latestEvents[0] as unknown as ReminderEvent;
            const updatedList = events.map((e) => (e.id === event.id ? updatedEvent : e));
            setEvents(updatedList);
            if (onEventsChange) onEventsChange(updatedList);
          }
          return;
        }
      }

      const resolvedRecord = data && data[0];

      // 4. Log the resolution in reminder_logs
      const { error: logErr } = await supabase.from('reminder_logs').insert([
        {
          telegram_id: event.telegram_id,
          medication_id: event.medication_id,
          scheduled_time: event.scheduled_for,
          response: action,
          delay_minutes: action === 'TAKEN' ? delayMinutes : null,
        },
      ]);

      if (logErr) throw logErr;

      // 5. Update local UI state immediately
      const updatedEvents = events.map((e) =>
        e.id === event.id
          ? { 
              ...e, 
              id: resolvedRecord ? resolvedRecord.id : e.id,
              reminder_status: resolvedStatus 
            }
          : e
      );
      setEvents(updatedEvents);
      if (onEventsChange) onEventsChange(updatedEvents);

      router.refresh();
    } catch (err: any) {
      console.error('[Today Schedule] Error resolving event:', err?.message || err, err);
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
    return ['PENDING_PATIENT', 'RETRYING_PATIENT', 'SNOOZED', 'ESCALATED_TO_CG', 'FUTURE_SCHEDULED'].includes(status);
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
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 max-w-sm w-full pointer-events-none">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className="pointer-events-auto flex items-start gap-3 p-4 rounded-2xl border border-white/20 bg-white/80 backdrop-blur-xl shadow-xl shadow-slate-900/10 animate-in slide-in-from-bottom-5 duration-300"
            >
              {toast.type === 'error' ? (
                <AlertTriangle className="w-5 h-5 text-danger shrink-0 mt-0.5" />
              ) : (
                <CheckCircle className="w-5 h-5 text-success shrink-0 mt-0.5" />
              )}
              <div className="flex-1 space-y-0.5">
                <h5 className="font-bold text-sm text-[#0F172A]">{toast.title}</h5>
                <p className="text-xs text-[#475569] leading-relaxed">{toast.message}</p>
              </div>
              <button
                onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                className="text-[#94A3B8] hover:text-[#475569] transition-colors p-0.5 hover:bg-slate-100 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
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

    // Capsule border depending on status
    const borderClass = isEscalated 
      ? 'border-danger/30 bg-danger/5 shadow-sm shadow-danger/10' 
      : isPending 
        ? 'border-border/60 hover:border-primary/40' 
        : 'border-border/40 opacity-90';

    return (
      <div 
        key={event.id} 
        className={`rounded-3xl min-h-[120px] border bg-card p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-sm hover:shadow-md transition-all duration-300 ${borderClass}`}
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
                className="px-6 py-3 text-sm font-black rounded-full bg-success text-success-foreground hover:bg-success/90 active:scale-[0.96] transition-all cursor-pointer shadow-md disabled:opacity-50"
              >
                {isUpdating ? '...' : userRole === 'CAREGIVER' ? 'Confirm Taken' : 'TAKE NOW'}
              </button>
              <button
                onClick={() => handleResolve(event, 'SKIP')}
                disabled={isUpdating}
                className="px-4 py-3 text-sm font-bold rounded-full bg-muted text-muted-foreground hover:bg-muted/80 active:scale-[0.96] transition-all cursor-pointer border border-border disabled:opacity-50"
              >
                {isUpdating ? '...' : 'Skip'}
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
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start gap-3 p-4 rounded-2xl border border-white/20 bg-white/80 backdrop-blur-xl shadow-xl shadow-slate-900/10 animate-in slide-in-from-bottom-5 duration-300"
          >
            {toast.type === 'error' ? (
              <AlertTriangle className="w-5 h-5 text-danger shrink-0 mt-0.5" />
            ) : (
              <CheckCircle className="w-5 h-5 text-success shrink-0 mt-0.5" />
            )}
            <div className="flex-1 space-y-0.5">
              <h5 className="font-bold text-sm text-[#0F172A]">{toast.title}</h5>
              <p className="text-xs text-[#475569] leading-relaxed">{toast.message}</p>
            </div>
            <button
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              className="text-[#94A3B8] hover:text-[#475569] transition-colors p-0.5 hover:bg-slate-100 rounded-md"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
