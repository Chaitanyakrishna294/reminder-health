'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { resolveReminderEvent } from '@/lib/reminder-events';
import { useUiMode } from '@/context/ui-mode-context';
import { Pill, Check, SkipForward, AlertCircle, Clock } from 'lucide-react';
import { PremiumToast } from '@/components/ui/premium-toast';
import LoadingMark from '@/components/ui/loading-mark';
import moment from 'moment-timezone';

/**
 * THIS CARD IS FOR RECENT MEMORY, NOT AN INFINITE BACKLOG.
 *
 * It used to select every UNCONFIRMED dose for the patient with no date floor and
 * no limit, so it asked about every dose ever left unanswered, forever. Measured
 * on real data 2026-08-17: 54 unconfirmed rows in four days, several medications
 * unanswered on every single day, accumulating without bound.
 *
 * That is the double-ask disease, and the mechanism was not what it looked like.
 * Answers DO reach the server and DO clear the status — one medication showed
 * TAKEN on the 14th and SKIPPED on the 15th while the 16th and 17th sat
 * unconfirmed. What the card showed was consecutive days of the SAME medication,
 * which reads exactly like being asked twice about one dose.
 *
 * The rule, set by the maintainer: a guess about a four-day-old dose is worse
 * data than an honest gap. Older unanswered doses stay in the record as
 * missed/unconfirmed and remain visible in planner history — the app simply
 * stops interrogating about them.
 */

/** Only doses this recent are worth asking about. Beyond it, memory is a guess. */
const REVIEW_WINDOW_HOURS = 48;
/** A short list someone can actually finish. Oldest first within the window. */
const REVIEW_MAX_ITEMS = 5;

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
        // The window and the cap, applied in the QUERY rather than after it: an
        // unbounded select was also the reason this card cost a growing amount on
        // every app open. Oldest-first inside the window, so the dose whose memory
        // is faintest is asked about first while it is still worth asking.
        .gte('scheduled_for', new Date(Date.now() - REVIEW_WINDOW_HOURS * 3600_000).toISOString())
        .order('scheduled_for', { ascending: true })
        .limit(REVIEW_MAX_ITEMS);

      if (error) throw error;
      // Same guard as the dashboard: a deleted medication leaves medication_id NULL, so
      // the join returns null and every read of event.medications.drug_name below throws.
      // Nothing to review for a medication that no longer exists.
      setEvents(((data as any[]) || []).filter(e => e.medications != null) as any);
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
      <div className="card-lift p-6 flex items-center justify-center min-h-[120px]">
        <div className="flex items-center gap-3 text-muted-foreground text-xs font-bold">
          <LoadingMark size={32} className="text-primary-strong" /> Loading review queue…
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    return null; // Don't render the panel if there are no unconfirmed medications to review
  }

  return (
    <>
      <div className="card-lift p-6 md:p-8 space-y-6 relative overflow-hidden font-sans">
        {/* Subtle decorative background gradient */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -z-10 pointer-events-none" />
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            {/* Says what it IS — recent doses only. The old title ("Help Us
                Complete Your Medication History") promised a complete record and
                so implied every gap ever, which is exactly what it used to ask
                about. Sentence case, and no "please" begging for data (ux-copy). */}
            <h3 className="text-lg font-black text-foreground tracking-tight flex items-center gap-2.5">
              <Pill className="w-5 h-5 text-primary-strong" />
              Doses from the last 2 days
            </h3>
            <p className="text-xs text-muted-foreground font-medium max-w-xl leading-relaxed">
              These were not confirmed at the time. If you remember, mark them — anything
              older stays as it is, because a guess is worse than a gap.
            </p>
          </div>
          <span className="shrink-0 bg-primary/10 border border-primary/20 text-primary-strong text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full w-max">
            {events.length} to check
          </span>
        </div>

        <div className="divide-y divide-border/60 text-xs">
          {events.map((event) => {
            /**
             * WHICH DAY, said in a word rather than a date.
             *
             * This is the other half of the double-ask. The window keeps the list
             * short, but inside 48 hours you will often have the SAME medication on
             * two consecutive days — verified on live data: "Nee 9:40 PM" appears
             * for both the 15th and the 16th. The day was already shown, as
             * "August 15, 2026" in 10px under a bold drug name, which is the easiest
             * thing on the card to miss. Two rows then look like one dose asked
             * twice, which is exactly what was reported.
             *
             * Inside a 48h window "Yesterday" and "Today" are always unambiguous and
             * are read at a glance, so the day leads and the absolute date goes.
             *
             * FLAGGED, not fixed here — `.tz('Asia/Kolkata')` is HARDCODED. For any
             * user outside IST this can name the wrong day, which on this card means
             * being asked about "yesterday's" dose that was actually today's. The
             * dashboard already threads a `referenceTimeZone` to other components
             * (see notifications-client-view); this one should take it too. That is a
             * correctness change with a prop signature attached, so it wants its own
             * commit rather than riding along inside a copy fix.
             */
            const dateObj = moment(event.scheduled_for).tz('Asia/Kolkata');
            const timeStr = dateObj.format('h:mm A');
            const startOfToday = moment().tz('Asia/Kolkata').startOf('day');
            const daysAgo = startOfToday.diff(dateObj.clone().startOf('day'), 'days');
            const dateStr =
              daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : dateObj.format('ddd D MMM');
            const isUpdating = resolvingId === event.id;

            return (
              <div
                key={event.id}
                className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all hover:bg-muted/30 -mx-6 px-6 rounded-[var(--r-card)]"
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
                    {/* The DAY leads and is legible — 12px, not 10, and the
                        day-word carries the emphasis because it is the thing that
                        distinguishes two rows of the same medication. */}
                    <p className="text-xs text-muted-foreground font-bold mt-0.5">
                      <span className="text-foreground">{dateStr}</span>, {timeStr}
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
