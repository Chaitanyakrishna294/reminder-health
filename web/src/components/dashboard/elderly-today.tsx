'use client';

/**
 * ELDERLY MODE — THE ONE-QUESTION SCREEN.
 *
 * The whole viewport answers "what do I do now?" and nothing else. No rail, no
 * drawers, no week strip, no date navigation, no dose strip, no inventory, no
 * analytics. Those are not withheld to simplify the code; they are withheld because
 * every one of them is a thing to read before the answer appears, and the test this
 * screen has to pass is whether someone who has never used a smartphone knows what
 * to tap within two seconds.
 *
 * A PRESENTATION BRANCH, NOT A SECOND APP. The previous elderly view was a parallel
 * implementation and it rotted: the week strip, the day rail, past-day correction
 * and the deep link all landed in normal mode and none of them reached it, because
 * nobody remembers to build a thing twice. This component computes NOTHING about
 * doses. Every value arrives as a prop from the same derivation the standard view
 * uses, and resolving goes through the same `resolveReminderEvent` RPC wrapper. If
 * the dose logic changes, it changes here too, because there is only one of it.
 *
 * WHAT IS DELIBERATELY ABSENT: corrections and history. Fixing a mis-logged dose is
 * the caregiver's job, from their own phone or from standard mode — it needs
 * judgement about the past, which is exactly the kind of decision this screen exists
 * to avoid asking for.
 *
 * The four states, in the order they take precedence:
 *   1. a dose is due (or focused from the missed line) → the big card
 *   2. everything answered                            → the celebration
 *   3. something is scheduled later                   → the calm "nothing right now"
 *   4. nothing scheduled at all                       → the same calm shape
 */

import React, { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { resolveReminderEvent } from '@/lib/reminder-events';
import { isAttentionStatus } from '@/lib/schedule/dose-attention';
import { getUnitIcon } from '@/components/dashboard/dashboard-helpers';
import { unitPhrase } from '@/components/medications/medication-form-options';
import BrainMascot from '@/components/dashboard/brain-mascot';
import { PremiumToast } from '@/components/ui/premium-toast';
import type { ReminderEvent } from '@/components/dashboard/todays-schedule';

interface ElderlyTodayProps {
  /** Today's doses — the same array the standard view renders. */
  events: ReminderEvent[];
  /** Earliest overdue, else the missed backlog, else next up. Same pick as the gate. */
  nextPendingEvent?: ReminderEvent;
  /** The missed backlog, already partitioned by the shared rule. */
  attentionEvents: ReminderEvent[];
  userRole: 'PATIENT' | 'CAREGIVER';
  readOnly: boolean;
  onEventsChange: (events: ReminderEvent[]) => void;
  /** Answered today, and scheduled today. Both derived above; shown as a sentence. */
  todayTaken: number;
  todayTotal: number;
}

/** Time in the viewer's locale, hour and minute only. Rendered client-side only. */
function timeOf(iso: string, mounted: boolean) {
  if (!mounted) return '--:--';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ElderlyToday({
  events,
  nextPendingEvent,
  attentionEvents,
  userRole,
  readOnly,
  onEventsChange,
  todayTaken,
  todayTotal,
}: ElderlyTodayProps) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  /** A dose chosen from the missed line — it takes over the big card. */
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [toasts, setToasts] = useState<{ id: string; title: string; message: string; type: 'success' | 'error' }[]>([]);

  React.useEffect(() => {
    const start = setTimeout(() => { setMounted(true); setNowMs(Date.now()); }, 0);
    const tick = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => { clearTimeout(start); clearInterval(tick); };
  }, []);

  const showToast = (title: string, message: string, type: 'success' | 'error' = 'success') => {
    const id = String(nowMs) + title;
    setToasts((prev) => [...prev, { id, title, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  };

  const resolve = async (event: ReminderEvent, action: 'TAKEN' | 'SKIP') => {
    if (busy || readOnly) return;
    setBusy(true);
    try {
      const rec = await resolveReminderEvent({
        supabase,
        eventId: event.id,
        medicationId: event.medication_id,
        scheduledFor: event.scheduled_for,
        action,
        actorRole: userRole,
      });
      onEventsChange(
        events.map((e) =>
          e.id === event.id ? { ...e, id: rec.event_id ?? e.id, reminder_status: rec.reminder_status } : e,
        ),
      );
      setFocusedId(null);
      router.refresh();
    } catch {
      // One sentence, no blame, no error code. The recovery is to try again.
      showToast('Not saved', 'Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  // ── Which dose, if any, the big card is asking about ───────────────────────
  const focused = focusedId != null ? events.find((e) => e.id === focusedId) : undefined;
  const dueNow = nextPendingEvent
    && new Date(nextPendingEvent.scheduled_for).getTime() <= nowMs
    && mounted
    ? nextPendingEvent
    : undefined;
  const asking = focused ?? dueNow;

  // Everything that was scheduled today has an answer.
  const allAnswered = events.length > 0
    && events.every((e) => ['TAKEN', 'RESOLVED_BY_CG', 'SKIPPED'].includes(e.reminder_status));

  // The gentle missed line. Excludes whatever the card is already asking about, so
  // the same dose is never both the question and the footnote.
  const missed = attentionEvents.filter((e) => e.id !== asking?.id);

  const doseLine = (event: ReminderEvent) => {
    const amount = event.medications.dosage_amount;
    return [
      amount != null && amount !== 0 ? `${amount} ${unitPhrase(event.medications.unit_type, amount)}` : '',
      timeOf(event.scheduled_for, mounted),
    ].filter(Boolean).join(' · ');
  };

  // Doses still ahead, excluding whatever the card is already asking about. Read
  // only — name and time, no buttons. It answers "what else is coming today", which
  // people do ask, WITHOUT asking them to decide anything about it.
  const later = events
    .filter((e) =>
      e.id !== asking?.id
      && !['TAKEN', 'RESOLVED_BY_CG', 'SKIPPED'].includes(e.reminder_status)
      && !isAttentionStatus(e.reminder_status)
      && new Date(e.scheduled_for).getTime() > nowMs)
    .sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());

  return (
    <div className="w-full max-w-2xl mx-auto px-1 pb-4">
      {/* THE HEADER. The first version had none, and a lone card floating on the
          page reads like an error state rather than a screen you are on. Two lines:
          where you are, and how the day is going — a sentence, not a chart. */}
      <header className="mb-5 px-1">
        <h2 className="font-mono uppercase tracking-[0.14em] text-sm text-muted-foreground">
          Today
        </h2>
        {todayTotal > 0 && (
          <p className="mt-1 text-2xl font-bold text-foreground tabular-nums" suppressHydrationWarning>
            {todayTaken} of {todayTotal} taken
          </p>
        )}
      </header>

      {asking ? (
        /* ── STATE 1: a dose is due ────────────────────────────────────────── */
        <section className="bg-card border-2 border-primary/30 rounded-[32px] p-7 shadow-sm text-center">
          <span
            className="mx-auto mb-5 w-24 h-24 rounded-3xl bg-primary-soft text-primary-strong flex items-center justify-center [&_svg]:w-12 [&_svg]:h-12"
            aria-hidden
          >
            {getUnitIcon(asking.medications.unit_type, 'w-12 h-12')}
          </span>

          {/* The name is the biggest thing on the screen, because it is the only
              thing the person has to recognise. */}
          <h1 className="text-5xl font-black text-foreground leading-[1.05] text-balance break-words">
            {asking.medications.drug_name}
          </h1>
          <p className="mt-3 text-2xl font-bold text-muted-foreground font-mono tabular-nums" suppressHydrationWarning>
            {doseLine(asking)}
          </p>

          {readOnly ? (
            <p className="mt-7 text-xl font-bold text-muted-foreground">You are viewing only.</p>
          ) : (
            <>
              {/* 72px+ and full width. One tap, one meaning. */}
              <button
                type="button"
                onClick={() => resolve(asking, 'TAKEN')}
                disabled={busy}
                className="mt-7 w-full min-h-[88px] rounded-3xl bg-primary-strong text-primary-strong-foreground text-3xl font-black active:scale-[0.98] transition-transform cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {busy ? 'Saving…' : 'Taken'}
              </button>
              {/* Skip is deliberately quiet and below. It is a legitimate answer, not
                  a failure — but it is not the one being asked for. */}
              <button
                type="button"
                onClick={() => resolve(asking, 'SKIP')}
                disabled={busy}
                className="mt-3 w-full min-h-[56px] rounded-2xl text-xl font-bold text-muted-foreground hover:bg-muted active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Skip
              </button>
            </>
          )}
        </section>
      ) : allAnswered ? (
        /* ── STATE 2: everything answered — an approved celebration moment ─── */
        <section className="bg-card border-2 border-success/25 rounded-[32px] p-7 text-center shadow-sm">
          <span
            className="mx-auto mb-5 w-24 h-24 rounded-full bg-success/15 text-success-strong flex items-center justify-center"
            aria-hidden
          >
            <Check className="w-14 h-14" strokeWidth={3} />
          </span>
          <h1 className="text-4xl font-black text-foreground text-balance">All done for today</h1>
          <p className="mt-2 text-xl font-bold text-muted-foreground">Nothing left to take.</p>
          <div className="mt-4 flex justify-center">
            <BrainMascot size={144} mood="proud" />
          </div>
        </section>
      ) : (
        /* ── STATES 3 & 4: nothing due right now ───────────────────────────── */
        <section className="bg-card border-2 border-border rounded-[32px] p-7 text-center shadow-sm">
          <h1 className="text-4xl font-black text-foreground text-balance">Nothing right now</h1>
          {nextPendingEvent ? (
            <p className="mt-3 text-2xl font-bold text-muted-foreground text-balance" suppressHydrationWarning>
              Next: {nextPendingEvent.medications.drug_name} at{' '}
              <span className="font-mono tabular-nums text-foreground">
                {timeOf(nextPendingEvent.scheduled_for, mounted)}
              </span>
            </p>
          ) : (
            <p className="mt-3 text-2xl font-bold text-muted-foreground">No medicines scheduled today.</p>
          )}
          <div className="mt-4 flex justify-center">
            {/* peaceful, not happy: this is a quiet moment, not an achievement. */}
            <BrainMascot size={144} mood="peaceful" />
          </div>
        </section>
      )}

      {/* ── LATER TODAY. Read-only on purpose. ───────────────────────────────
          The first version showed the one card and nothing else, which left no
          answer to "what else is coming" — so the screen felt like it was hiding
          things. These are rows, not controls: name and time, no buttons, nothing
          to decide. The one decision on this screen stays the card above. */}
      {later.length > 0 && (
        <section className="mt-6">
          <h2 className="font-mono uppercase tracking-[0.14em] text-sm text-muted-foreground px-1 mb-2">
            Later today
          </h2>
          <ul className="space-y-2">
            {later.map((event) => (
              <li
                key={event.id}
                className="bg-card border border-border rounded-2xl px-5 py-4 flex items-center justify-between gap-4"
              >
                <span className="text-xl font-bold text-foreground truncate">
                  {event.medications.drug_name}
                </span>
                <span
                  className="text-xl font-bold text-muted-foreground font-mono tabular-nums shrink-0"
                  suppressHydrationWarning
                >
                  {timeOf(event.scheduled_for, mounted)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── The missed line. ONE line, whatever the count. ───────────────────
          Zero-blame: it states what the record says and offers the way to fix it.
          No count badge, no red panel, no "you forgot" — the person reading this
          may already know, and may already feel bad about it. */}
      {missed.length > 0 && !readOnly && (
        <ul className="mt-6 space-y-2">
          {missed.map((event) => (
            <li key={event.id}>
              <button
                type="button"
                onClick={() => setFocusedId(event.id)}
                className="w-full min-h-[64px] px-5 py-3 rounded-2xl bg-muted/60 border border-border text-left flex items-center justify-between gap-4 hover:bg-muted active:scale-[0.99] transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span className="text-xl font-bold text-foreground text-balance">
                  {event.medications.drug_name} not taken
                </span>
                <span className="text-lg font-bold text-primary-strong shrink-0">Open</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <PremiumToast toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </div>
  );
}

/** Kept adjacent to the component that owns the rule, so a future reader finds it. */
export { isAttentionStatus };
