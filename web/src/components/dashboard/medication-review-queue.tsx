'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { resolveReminderEvent } from '@/lib/reminder-events';
import { useUiMode } from '@/context/ui-mode-context';
import { Pill, Check, SkipForward, AlertCircle, Clock } from 'lucide-react';
import { PremiumToast } from '@/components/ui/premium-toast';
import moment from 'moment-timezone';

interface MedicationReviewQueueProps {
  patientTelegramChatId: string;
  userRole: 'PATIENT' | 'CAREGIVER';
  onResolveSuccess?: () => void;
}

interface UnconfirmedEvent {
  id: number;
  medication_id: number;
  telegram_id: string;
  scheduled_for: string;
  reminder_status: string;
  medications: {
    drug_name: string;
    dosage: string;
    priority_level: string;
  };
}

export default function MedicationReviewQueue({
  patientTelegramChatId,
  userRole,
  onResolveSuccess,
}: MedicationReviewQueueProps) {
  const [events, setEvents] = useState<UnconfirmedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [toasts, setToasts] = useState<{ id: string; title: string; message: string; type: 'success' | 'error' }[]>([]);
  
  const supabase = createClient();
  const router = useRouter();
  const { isElderly } = useUiMode();

  const showToast = (title: string, message: string, type: 'success' | 'error' = 'success') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, title, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const fetchUnconfirmedEvents = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('reminder_events')
        .select(`
          id,
          medication_id,
          telegram_id,
          scheduled_for,
          reminder_status,
          medications:medication_id (
            drug_name,
            dosage,
            priority_level
          )
        `)
        .eq('telegram_id', patientTelegramChatId)
        .eq('reminder_status', 'UNCONFIRMED')
        .order('scheduled_for', { ascending: false });

      if (error) throw error;
      setEvents((data as any) || []);
    } catch (err) {
      console.error('[MedicationReviewQueue] Error fetching unconfirmed events:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (patientTelegramChatId) {
      fetchUnconfirmedEvents();
    }
  }, [patientTelegramChatId]);

  const handleResolve = async (event: UnconfirmedEvent, action: 'TAKEN' | 'SKIP') => {
    if (resolvingId !== null) return;
    setResolvingId(event.id);

    try {
      const channel = userRole === 'PATIENT' ? 'REVIEW_QUEUE' : 'CAREGIVER_CONSOLE';
      const resolved = await resolveReminderEvent({
        supabase,
        eventId: event.id,
        medicationId: event.medication_id,
        scheduledFor: event.scheduled_for,
        action,
        actorRole: userRole,
        resolutionChannel: channel,
      });

      showToast(
        action === 'TAKEN' ? 'Dose Confirmed Taken' : 'Dose Marked Skipped',
        `${event.medications.drug_name} was successfully resolved.`,
        'success'
      );

      // Remove from local list
      setEvents((prev) => prev.filter((e) => e.id !== event.id));
      
      if (onResolveSuccess) onResolveSuccess();
      router.refresh();
    } catch (err: any) {
      console.error('[MedicationReviewQueue] Resolve error:', err);
      showToast('Error', err.message || 'Failed to resolve medication review.', 'error');
    } finally {
      setResolvingId(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-3xl p-6 flex items-center justify-center min-h-[120px] shadow-sm">
        <div className="flex items-center gap-3 text-muted-foreground text-xs font-bold animate-pulse">
          <Clock className="w-4 h-4 animate-spin text-primary" /> Loading Review Queue...
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    return null; // Don't render the panel if there are no unconfirmed medications to review
  }

  return (
    <>
      <div className="bg-card border border-border rounded-3xl p-6 md:p-8 space-y-6 shadow-sm relative overflow-hidden font-sans">
        {/* Subtle decorative background gradient */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -z-10 pointer-events-none" />
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-lg font-black text-foreground tracking-tight flex items-center gap-2.5">
              <Pill className="w-5 h-5 text-primary" />
              Help Us Complete Your Medication History
            </h3>
            <p className="text-xs text-muted-foreground font-medium max-w-xl leading-relaxed">
              We noticed a few medications from earlier that were not confirmed. Please let us know if you took them.
            </p>
          </div>
          <span className="shrink-0 bg-primary/10 border border-primary/20 text-primary text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full w-max">
            {events.length} Pending Review
          </span>
        </div>

        <div className="divide-y divide-border/60 text-xs">
          {events.map((event) => {
            const dateObj = moment(event.scheduled_for).tz('Asia/Kolkata');
            const timeStr = dateObj.format('h:mm A');
            const dateStr = dateObj.format('MMMM D, YYYY');
            const isUpdating = resolvingId === event.id;

            return (
              <div
                key={event.id}
                className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all hover:bg-muted/30 -mx-6 px-6 rounded-2xl"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/5 text-primary border border-primary/10 flex items-center justify-center shrink-0">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-extrabold text-foreground tracking-tight">
                      {event.medications.drug_name}
                      {event.medications.dosage && (
                        <span className="font-bold text-muted-foreground text-xs ml-1.5">
                          ({event.medications.dosage})
                        </span>
                      )}
                    </h4>
                    <p className="text-[10px] text-muted-foreground font-bold mt-0.5">
                      Scheduled for: {dateStr} at {timeStr}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-center">
                  <button
                    onClick={() => handleResolve(event, 'TAKEN')}
                    disabled={isUpdating}
                    className="h-9 px-4 text-xs font-black rounded-xl bg-success hover:bg-success/90 text-success-foreground active:scale-[0.96] transition-all cursor-pointer shadow-sm disabled:opacity-50 flex items-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" /> Confirm Taken
                  </button>
                  <button
                    onClick={() => handleResolve(event, 'SKIP')}
                    disabled={isUpdating}
                    className="h-9 px-4 text-xs font-extrabold rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground active:scale-[0.96] transition-all cursor-pointer border border-border disabled:opacity-50 flex items-center gap-1"
                  >
                    <SkipForward className="w-3.5 h-3.5" /> Skipped
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <PremiumToast toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </>
  );
}
