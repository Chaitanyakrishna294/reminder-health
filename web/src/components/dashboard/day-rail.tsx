'use client';

/**
 * The day rail — Today's spine (redesign §03, approved 2026-08-12).
 *
 * One vertical line runs the length of the day and changes colour as it passes
 * through the four time-of-day slots, with dose cards hanging off it. The dose
 * that is DUE NOW is the only card allowed to break the rhythm: it grows and
 * carries the two big actions, and everything else stays quiet. That is the whole
 * hierarchy — one thing to do, and a record of the rest.
 *
 * Purely presentational. Every resolve guard, RPC call and toast stays in
 * TodaysSchedule, because those rules (who may resolve what, in which view mode)
 * are safety logic and must not be duplicated into a rendering component.
 *
 * Slot tints are SURFACES here and nowhere else: the spine, the pip, the dose-icon
 * chip. They never colour a button — the moment they do there are five accents and
 * no hierarchy left. The only interactive colour on this component is the pink.
 */

import React, { useEffect, useState } from 'react';
import { Check, Clock, SkipForward, AlertCircle, Pill, ChevronDown } from 'lucide-react';
import { groupBySlot, type SlotMeta } from '@/lib/design/slots';
import { unitPhrase } from '@/components/medications/medication-form-options';
import type { ReminderEvent } from '@/components/dashboard/todays-schedule';

/** Tailwind can't build class names at runtime, so slot tints are mapped explicitly. */
const SLOT_CLASS: Record<string, { rail: string; pip: string; chip: string; label: string }> = {
  // `label` uses the -ink variant, never the surface hue: #E8A44E on the paper
  // ground is ~1.9:1, nowhere near the 4.5:1 floor. Surface tints tint surfaces;
  // text needs its own value. (Caught reviewing this file — it shipped wrong once.)
  morning: { rail: 'bg-slot-morning/30', pip: 'border-slot-morning', chip: 'bg-slot-morning/15', label: 'text-slot-morning-ink' },
  midday: { rail: 'bg-slot-midday/30', pip: 'border-slot-midday', chip: 'bg-slot-midday/15', label: 'text-slot-midday-ink' },
  evening: { rail: 'bg-slot-evening/30', pip: 'border-slot-evening', chip: 'bg-slot-evening/15', label: 'text-slot-evening-ink' },
  night: { rail: 'bg-slot-night/30', pip: 'border-slot-night', chip: 'bg-slot-night/15', label: 'text-slot-night-ink' },
};

type Verdict = 'taken' | 'skipped' | 'missed' | 'waiting' | 'due' | 'later';

function verdictOf(status: string, scheduledFor: string, nowMs: number): Verdict {
  if (status === 'TAKEN' || status === 'RESOLVED_BY_CG') return 'taken';
  if (status === 'SKIPPED') return 'skipped';
  if (status === 'MISSED' || status === 'PENDING_REVIEW' || status === 'UNCONFIRMED') return 'missed';
  if (status === 'SNOOZED') return 'waiting';
  return new Date(scheduledFor).getTime() <= nowMs ? 'due' : 'later';
}

/** Sentence case throughout — uppercase is reserved for structural eyebrows. */
const VERDICT_META: Record<Verdict, { label: string; cls: string; Icon: typeof Check }> = {
  taken: { label: 'Taken', cls: 'bg-success/15 text-success-strong', Icon: Check },
  skipped: { label: 'Skipped', cls: 'bg-muted text-muted-foreground', Icon: SkipForward },
  missed: { label: 'Missed', cls: 'bg-danger/15 text-danger-strong', Icon: AlertCircle },
  waiting: { label: 'Snoozed', cls: 'bg-warning/15 text-warning-strong', Icon: Clock },
  due: { label: 'Due now', cls: 'bg-primary/15 text-primary-strong', Icon: Clock },
  later: { label: 'Later', cls: 'bg-muted text-muted-foreground', Icon: Clock },
};

interface DayRailProps {
  events: ReminderEvent[];
  /** Medication timezone per event — slotting must never use the device's. */
  timeZoneFor: (event: ReminderEvent) => string | null | undefined;
  canResolve: (event: ReminderEvent) => boolean;
  onResolve: (event: ReminderEvent, action: 'TAKEN' | 'SKIP') => void;
  /**
   * Same-day correction of a dose logged the wrong way round.
   *
   * Not cosmetic, and not optional in spirit: the correction window closes at
   * midnight, so a dose recorded wrongly with nowhere to change it is wrong
   * permanently. The list this rail replaces carried a "Change to …" link under
   * every resolved dose; dropping it would have been a silent data regression.
   */
  canCorrect?: (event: ReminderEvent) => boolean;
  onCorrect?: (event: ReminderEvent) => void;
  updatingId: number | null;
  isElderly: boolean;
  /**
   * Current time, owned by the parent's 60s clock.
   *
   * A prop rather than `Date.now()` in render, for two reasons: reading the clock
   * during render is impure and produces unstable output across re-renders, and
   * the server has no idea what "now" is on the user's device — deriving "due now"
   * during SSR would hydrate a different card than it rendered. Pass 0 until
   * mounted and nothing reads as due, which is the correct pre-hydration state.
   */
  nowMs: number;
  /**
   * The dose selected in the blister strip above. Two effects: its slot is forced
   * open even if the user collapsed that drawer, and the rail scrolls its card
   * into view. Tapping a pocket is a request to SEE that dose — the strip and the
   * rail are two views of the same day, and this is what connects them.
   */
  selectedEventId?: number | null;
}

export default function DayRail({
  events,
  timeZoneFor,
  canResolve,
  onResolve,
  canCorrect,
  onCorrect,
  updatingId,
  isElderly,
  nowMs,
  selectedEventId,
}: DayRailProps) {
  // Which drawers the user has shut. Held in memory only, deliberately: a slot
  // collapsed yesterday should not hide today's doses on a fresh open.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggleSlot = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Tapping a pocket in the strip scrolls its card into view. rAF rather than a
  // direct call so a force-opened drawer has actually laid out first — otherwise
  // the browser measures a collapsed section and scrolls to the wrong place.
  useEffect(() => {
    if (selectedEventId == null) return;
    const raf = requestAnimationFrame(() => {
      document
        .getElementById(`rail-dose-${selectedEventId}`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedEventId]);

  const groups = groupBySlot(
    [...events].sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime()),
    (e) => e.scheduled_for,
    timeZoneFor,
  );

  if (groups.length === 0) return null;

  // Only ONE card may break the rhythm. If several doses are overdue, the earliest
  // wins — asking about the oldest first matches the gate's queue order, so the two
  // surfaces never disagree about which dose is "the" one right now.
  const dueNowId = events
    .filter((e) => verdictOf(e.reminder_status, e.scheduled_for, nowMs) === 'due')
    .sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime())[0]?.id;

  // The guided tour's "your next dose" step used to spotlight the hero card. This
  // rail is the hero's successor, so the anchor moves to the dose the rail is
  // actually asking about: the due-now card when there is one, otherwise the
  // earliest dose still unanswered — the same "needs your attention next" the hero
  // meant. When every dose is resolved there is deliberately no anchor; GuideTour
  // already handles a missing target by centring its bubble with no spotlight.
  const tourAnchorId = dueNowId ?? [...events]
    .filter((e) => {
      const v = verdictOf(e.reminder_status, e.scheduled_for, nowMs);
      return v !== 'taken' && v !== 'skipped';
    })
    .sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime())[0]?.id;

  const timeOf = (iso: string, tz?: string | null) => {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz || undefined,
      }).format(new Date(iso));
    } catch {
      return '';
    }
  };

  return (
    <div className="space-y-1">
      {groups.map(({ slot, items }) => (
        <SlotGroup
          key={slot.id}
          slot={slot}
          items={items}
          dueNowId={dueNowId}
          tourAnchorId={tourAnchorId}
          selectedEventId={selectedEventId}
          // A shut drawer never hides the dose you just asked to see.
          expanded={!collapsed.has(slot.id) || items.some((e) => e.id === selectedEventId)}
          onToggle={() => toggleSlot(slot.id)}
          nowMs={nowMs}
          timeOf={timeOf}
          timeZoneFor={timeZoneFor}
          canResolve={canResolve}
          onResolve={onResolve}
          canCorrect={canCorrect}
          onCorrect={onCorrect}
          updatingId={updatingId}
          isElderly={isElderly}
        />
      ))}
    </div>
  );
}

function SlotGroup({
  slot, items, dueNowId, tourAnchorId, selectedEventId, expanded, onToggle,
  nowMs, timeOf, timeZoneFor,
  canResolve, onResolve, canCorrect, onCorrect, updatingId, isElderly,
}: {
  slot: SlotMeta;
  items: ReminderEvent[];
  dueNowId?: number;
  tourAnchorId?: number;
  expanded: boolean;
  onToggle: () => void;
  nowMs: number;
  timeOf: (iso: string, tz?: string | null) => string;
} & Omit<DayRailProps, 'events' | 'nowMs'>) {
  const c = SLOT_CLASS[slot.id];

  // What a shut drawer still has to admit. Collapsing must never be a way to lose
  // track of a dose, so the header carries the count and how many need answering.
  //
  // "Need answering" is deliberately NOT "not yet resolved": a dose scheduled for
  // this evening is not owed anything yet, and counting it would make a calm
  // drawer read as a backlog. Only due, missed and snoozed are asking.
  const openCount = items.filter((e) => {
    const v = verdictOf(e.reminder_status, e.scheduled_for, nowMs);
    return v === 'due' || v === 'missed' || v === 'waiting';
  }).length;
  const summary = [
    `${items.length} ${items.length === 1 ? 'dose' : 'doses'}`,
    openCount > 0 ? `${openCount} to answer` : null,
  ].filter(Boolean).join(' · ');

  return (
    <section className="relative pl-9 pb-1">
      {/* The spine. Aria-hidden: it encodes time of day, which the slot label already
          states in words — a screen reader gains nothing from the line itself. */}
      <span aria-hidden className={`absolute left-[11px] top-2 bottom-0 w-0.5 rounded ${c.rail}`} />
      {/* Anchored to the section rather than left to its static position: the header
          is a 44px target now, so an unpositioned pip floats to the top of it. */}
      <span aria-hidden className={`absolute left-1 top-[26px] w-4 h-4 rounded-full bg-card border-[3px] ${c.pip}`} />

      <header className="mt-3 mb-2">
        <h3>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="w-full min-h-11 flex items-center justify-between gap-3 text-left cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span className="flex items-baseline gap-2 min-w-0">
              <span className={`font-mono uppercase tracking-[0.14em] shrink-0 ${isElderly ? 'text-sm' : 'text-[11px]'} ${c.label}`}>
                {slot.label}
              </span>
              {!expanded && (
                <span className={`font-mono text-muted-foreground tabular-nums truncate ${isElderly ? 'text-xs' : 'text-[10px]'}`}>
                  {summary}
                </span>
              )}
            </span>
            <ChevronDown
              aria-hidden
              className={`shrink-0 text-muted-foreground transition-transform duration-200 ${expanded ? 'rotate-180' : ''} ${isElderly ? 'w-6 h-6' : 'w-4 h-4'}`}
            />
          </button>
        </h3>
      </header>

      {expanded && (
        <div className="space-y-2">
          {items.map((event) => (
            <DoseCard
              key={event.id}
              event={event}
              slotChip={c.chip}
              isDueNow={event.id === dueNowId}
              isTourAnchor={event.id === tourAnchorId}
              isSelected={event.id === selectedEventId}
              nowMs={nowMs}
              time={timeOf(event.scheduled_for, timeZoneFor(event))}
              canResolve={canResolve(event)}
              onResolve={onResolve}
              canCorrect={!!canCorrect?.(event) && !!onCorrect}
              onCorrect={onCorrect}
              isUpdating={updatingId === event.id}
              isElderly={isElderly}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function DoseCard({
  event, slotChip, isDueNow, isTourAnchor, isSelected, nowMs, time,
  canResolve, onResolve, canCorrect, onCorrect, isUpdating, isElderly,
}: {
  event: ReminderEvent;
  slotChip: string;
  isDueNow: boolean;
  isTourAnchor: boolean;
  isSelected: boolean;
  nowMs: number;
  time: string;
  canResolve: boolean;
  onResolve: (event: ReminderEvent, action: 'TAKEN' | 'SKIP') => void;
  canCorrect: boolean;
  onCorrect?: (event: ReminderEvent) => void;
  isUpdating: boolean;
  isElderly: boolean;
}) {
  const verdict = verdictOf(event.reminder_status, event.scheduled_for, nowMs);
  const meta = VERDICT_META[verdict];
  // `unit_type` is stored as an enum id (TABLET, ML, …), so joining it raw printed
  // "1.5 TABLET" — shouting, and wrong in number. unitPhrase is the same helper the
  // hero card used, and the one place plural rules live.
  const amount = event.medications.dosage_amount;
  const dose = (amount != null && amount !== 0
    ? `${amount} ${unitPhrase(event.medications.unit_type, amount)}`
    : '')
    || (event.medications.dosage && event.medications.dosage !== 'N/A' ? event.medications.dosage : '')
    || '';
  // Undo is offered only where there is something to undo. The chip directly above
  // it already names the current state, so the button itself stays one word.
  const showCorrect = canCorrect && (verdict === 'taken' || verdict === 'skipped');
  const tourAttr = isTourAnchor ? { 'data-tour': 'dash-next-med' } : {};
  // Scroll target for the blister strip above, plus the ring that answers "which
  // one did I just tap?" once you arrive. Same focus ring the strip's own pocket
  // uses, so the two views are visibly showing the same dose.
  const anchor = { id: `rail-dose-${event.id}` };
  const selectedRing = isSelected ? 'ring-2 ring-ring ring-offset-2 ring-offset-background' : '';

  // The rhythm-breaker. Expanded, outlined in the accent, and the only card on the
  // rail carrying full-width actions.
  if (isDueNow && canResolve) {
    return (
      <article {...anchor} {...tourAttr} className={`rounded-2xl bg-card border border-primary/35 p-4 shadow-[0_2px_4px_rgba(15,28,90,0.06)] ${selectedRing}`}>
        <div className="flex items-center gap-3">
          <span className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${slotChip}`}>
            <Pill className={isElderly ? 'w-7 h-7' : 'w-6 h-6'} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className={`font-bold text-foreground ${isElderly ? 'text-xl' : 'text-lg'}`}>
              {event.medications.drug_name}
            </p>
            <p className="font-mono text-muted-foreground tabular-nums text-[13px]" suppressHydrationWarning>
              {[dose, time && `due now, ${time}`].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>

        <div className="mt-3.5 grid grid-cols-[1fr_auto] gap-2">
          <button
            onClick={() => onResolve(event, 'TAKEN')}
            disabled={isUpdating}
            className="min-h-[52px] rounded-2xl bg-primary-strong text-primary-strong-foreground font-mono font-bold text-[15px] hover:bg-primary-strong-hover active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50"
          >
            {isUpdating ? '…' : 'Taken'}
          </button>
          <button
            onClick={() => onResolve(event, 'SKIP')}
            disabled={isUpdating}
            className="min-h-[52px] px-6 rounded-2xl border border-border text-muted-foreground font-mono font-bold text-[15px] hover:bg-muted active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50"
          >
            Skip
          </button>
        </div>
      </article>
    );
  }

  return (
    <article {...anchor} {...tourAttr} className={`rounded-2xl bg-card border border-transparent px-3.5 py-3 flex items-center gap-3 shadow-sm ${selectedRing}`}>
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${slotChip}`}>
        <Pill className={isElderly ? 'w-6 h-6' : 'w-[18px] h-[18px]'} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`font-semibold text-foreground truncate ${isElderly ? 'text-lg' : 'text-[15px]'}`}>
          {event.medications.drug_name}
        </p>
        <p className="font-mono text-muted-foreground tabular-nums text-xs" suppressHydrationWarning>
          {[dose, time].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-0.5">
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-mono font-semibold ${isElderly ? 'text-xs' : 'text-[10px]'} ${meta.cls}`}>
          <meta.Icon className="w-3 h-3" aria-hidden />
          {meta.label}
        </span>
        {showCorrect && (
          // One visible word, because the chip above it supplies the context. The
          // aria-label carries the full sentence for anyone who reaches this button
          // without seeing the chip beside it.
          <button
            onClick={() => onCorrect?.(event)}
            disabled={isUpdating}
            aria-label={`Change this dose to ${verdict === 'taken' ? 'skipped' : 'taken'}`}
            className={`min-h-11 px-1 font-semibold text-muted-foreground underline underline-offset-2 hover:text-primary-strong cursor-pointer disabled:opacity-50 ${isElderly ? 'text-sm' : 'text-xs'}`}
          >
            {isUpdating ? 'Changing…' : 'Change'}
          </button>
        )}
      </div>
    </article>
  );
}
