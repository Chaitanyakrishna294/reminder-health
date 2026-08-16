'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { resolveReminderEvent } from '@/lib/reminder-events';
import { isAttentionStatus } from '@/lib/schedule/dose-attention';
import { useUiMode } from '@/context/ui-mode-context';
import { useTheme } from '@/context/theme-context';
import { getUnitIcon } from '@/lib/design/dose-forms';
import { unitPhrase } from '@/components/medications/medication-form-options';
import { Check, X, Clock, Siren, AlertTriangle } from 'lucide-react';
import BrainMascot from './brain-mascot';

export interface GateEvent {
  id: number;
  medication_id: number;
  scheduled_for: string;
  reminder_status: string;
  medications: {
    drug_name: string;
    dosage?: string | null;
    dosage_amount?: number | null;
    unit_type?: string | null;
  };
}

interface MedDueGateProps {
  /** Full question queue, current dose first: due doses, then missed backlog. */
  queue: GateEvent[];
  userRole: 'PATIENT' | 'CAREGIVER';
  onResolved: (eventId: number, newStatus: string) => void;
  /** One-by-one "remind/ask me later": snooze just this dose for 30 min. */
  onSnooze: (eventId: number) => void;
  /** List view "Ask me later": snooze every queued dose for 30 min. */
  onSnoozeAll: () => void;
  /** The RPC can never resolve this dose (deactivated med, planner-shifted
   *  virtual dose, no permission) — parent removes it from the queue for the
   *  session so the gate doesn't re-ask forever. */
  onUnresolvable: (eventId: number) => void;
}

/** RPC error codes that will fail on every retry — retrying is dishonest. */
const PERMANENT_RPC_ERRORS = [
  'INVALID_SCHEDULED_TIME',
  'MEDICATION_NOT_FOUND',
  'EVENT_MEDICATION_MISMATCH',
  'VIRTUAL_EVENT_MUST_BE_FOR_TODAY',
  'NOT_AUTHORIZED',
] as const;

/** Honest copy when the app can never save this dose: it WILL show as missed. */
export const UNSAVEABLE_DOSE_COPY =
  "This dose couldn't be saved from the app. It will show as missed — please tell your caregiver.";

/** Honest copy for a permanently unresolvable dose, or null if retryable. */
export function permanentResolveError(message: string): string | null {
  const code = PERMANENT_RPC_ERRORS.find(c => message.includes(c));
  if (!code) return null;
  return code === 'NOT_AUTHORIZED'
    ? "You don't have permission to log doses for this patient."
    : UNSAVEABLE_DOSE_COPY;
}

function overdueLabel(scheduledFor: string): string {
  const mins = Math.floor((Date.now() - new Date(scheduledFor).getTime()) / 60000);
  if (mins < 1) return 'due now';
  if (mins < 60) return `${mins} min overdue`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m overdue` : `${h}h overdue`;
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const minutesLate = (iso: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));

/** How long the ring takes to fill. Two hours past the scheduled time is a
 *  full ring; beyond that it stays full rather than resetting. */
const RING_WINDOW_MINS = 120;

/** Placement of the three blurred colour fields behind the gate. Deliberately larger
 *  than the viewport and hung off the edges, so what shows is the soft middle of each
 *  field rather than a recognisable circle. */
const MESH_FIELDS = [
  { width: '24rem', height: '24rem', top: '-7rem', left: '-8rem' },
  { width: '21rem', height: '21rem', bottom: '-6rem', right: '-7rem' },
  { width: '18rem', height: '18rem', top: '38%', right: '-6rem' },
] as const;

/** Lateness drawn as an arc around the mascot. Shape carries the urgency, so it
 *  reads in dark mode, in elderly mode, and without colour vision — and the exact
 *  figure is always spelled out in the chip beside it, never colour alone. */
function OverdueRing({
  minutes,
  size,
  missed,
  children,
}: {
  minutes: number;
  size: number;
  missed: boolean;
  children: React.ReactNode;
}) {
  const R = 46;
  const CIRC = 2 * Math.PI * R;
  const filled = Math.min(minutes / RING_WINDOW_MINS, 1) * CIRC;
  return (
    <span
      className="relative inline-flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        className="absolute inset-0 -rotate-90"
        aria-hidden="true"
      >
        <circle cx="50" cy="50" r={R} fill="none" stroke="var(--border)" strokeWidth="3.5" />
        {filled > 0 && (
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke={missed ? 'var(--danger)' : 'var(--warning)'}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${CIRC}`}
          />
        )}
      </svg>
      {/* A soft lens for the mascot to sit on. Without it the brain art sank into the
          navy in dark mode — it is a small pink drawing on a large dark field. */}
      <span className="absolute inset-[8%] rounded-full bg-white/80 dark:bg-white/[0.10] backdrop-blur-md ring-1 ring-white/50 dark:ring-white/10" />
      <span className="relative">{children}</span>
    </span>
  );
}

export default function MedDueGate({ queue, userRole, onResolved, onSnooze, onSnoozeAll, onUnresolvable }: MedDueGateProps) {
  const supabase = createClient();
  const router = useRouter();
  const { isElderly } = useUiMode();
  const { theme } = useTheme();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [small, setSmall] = useState(false);
  /**
   * FIT LEVEL — 0 roomy, 1 compact, 2 tight. Chosen by MEASURING, never guessed.
   *
   * Two attempts got this wrong before, both by picking a number:
   *
   * 1. `small` (below) tests WIDTH, which says nothing about whether the question
   *    and its three answers fit. A 412x915 phone took the LARGER ring for being
   *    wide, then overflowed.
   * 2. Replacing it with `innerHeight < 760` failed on the actual device, because
   *    a modern Android webview is ~830-900 CSS px tall — the condition was simply
   *    false and the screen never changed.
   *
   * There is no threshold worth guessing here. The content's height depends on the
   * drug name's length, the LANGUAGE (the same sentence in Tamil or Hindi sets
   * taller than in English), the queue's size, whether the view toggle is present,
   * and the user's own font scaling. So this measures the rendered column against
   * the viewport and steps down until it fits.
   *
   * It only ever steps DOWN within a viewport, and resets to 0 when the viewport
   * changes, so it converges instead of oscillating between two levels.
   *
   * A gate you have to scroll to answer has already failed at the only thing it
   * does. The container is `overflow-y-auto`, so it did scroll — silently, with
   * no affordance, which is why it read as stuck rather than scrollable.
   *
   * NON-ELDERLY ONLY. Elderly owns its scale and is excluded from the redesign, so
   * it is pinned at level 0 and every value below is guarded.
   */
  const [level, setLevel] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);

  /**
   * THE GATE RENDERS INTO document.body, NOT WHERE IT IS WRITTEN.
   *
   * `position: fixed` is only relative to the viewport if NO ancestor establishes
   * a containing block — and a transform, filter, backdrop-filter, perspective or
   * `contain` on any ancestor does exactly that. The dashboard's `page-enter`
   * wrapper carries an animated transform and keeps it applied, so measured on a
   * 764px-tall viewport a `fixed inset-0` child inside it came out **3000px tall**,
   * i.e. sized to the whole scrollable page.
   *
   * Every symptom followed from that one fact: the gate no longer covered the
   * screen (the header and the nav painted over it), `justify-center` centred the
   * question in a 3000px box so there were hundreds of blank pixels above and
   * below it, and the fit search below compared against a 3000px clientHeight,
   * found no overflow, and never stepped down — which is why the previous two
   * spacing fixes appeared to do nothing at all.
   *
   * A portal to `document.body` puts the gate outside every wrapper, so no styling
   * choice made in a layout above it can ever resize or re-stack it again. This is
   * also why the nav (z-40) stopped covering it: the gate's z-[120] finally sits in
   * the same stacking context as the nav rather than trapped beneath it.
   */
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  useEffect(() => setPortalHost(document.body), []);
  // Session-local: every gate appearance starts back at one-by-one (safety default).
  /**
   * ALL-AT-ONCE IS THE DEFAULT, except in elderly.
   *
   * It used to open on 'one' always, so four doses at 08:00 were four
   * consecutive questions — and by the second one the person has already
   * swallowed the handful and is answering from memory. A handful is one
   * handful; the list shows it and each dose is still answered independently.
   *
   * Elderly keeps one-at-a-time, per the one-question philosophy. That is
   * presentation only: the other doses are still outstanding, still laddering
   * and still on the rail — the screen just asks about one at a time.
   */
  const [view, setView] = useState<'one' | 'list'>(isElderly ? 'one' : 'list');
  // List rows already saved, kept on screen briefly as confirmation before removal.
  const [flashIds, setFlashIds] = useState<number[]>([]);
  // One-by-one: pin the dose being asked. The parent re-renders every 60s and on
  // realtime events, which can reorder the queue — without the pin, a newly-due
  // dose could jump to position 0 under the patient's finger and their tap would
  // log TAKEN for a dose they never took. The shown dose only advances when the
  // pinned dose leaves the queue (resolved / snoozed / unresolvable), never by
  // queue reordering.
  const [askedId, setAskedId] = useState<number | null>(null);
  // A dose the RPC can never save. The patient must acknowledge (OK) BEFORE we
  // mark it unresolvable — otherwise the parent filter could empty the queue and
  // unmount the gate before the message paints, indistinguishable from a save.
  const [permanentError, setPermanentError] = useState<{ id: number; message: string } | null>(null);

  /** Bumped on any viewport change, to restart the fit search from roomy. */
  const [viewportKey, setViewportKey] = useState(0);

  useEffect(() => {
    const f = () => {
      setSmall(window.innerWidth < 420);
      // Re-measure from the top: a phone turned sideways loses half its height in
      // one frame, and a level chosen for the tall orientation is wrong for it.
      setLevel(0);
      setViewportKey((k) => k + 1);
    };
    f();
    window.addEventListener('resize', f);
    window.addEventListener('orientationchange', f);
    return () => {
      window.removeEventListener('resize', f);
      window.removeEventListener('orientationchange', f);
    };
  }, []);


  // Modal focus management: the gate covers the dashboard, but without this a
  // keyboard/screen-reader user could Tab into the dashboard's own Take/Skip
  // buttons BEHIND the overlay and log a dose they cannot see. On mount, move
  // focus into the gate; while open, trap Tab inside it; on unmount, restore
  // focus. Escape deliberately does nothing — there is no dismiss, snoozing is
  // an explicit button.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    container.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const gate = containerRef.current;
      if (!gate) return;
      const focusables = Array.from(
        gate.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusables.length === 0) {
        e.preventDefault();
        gate.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      // Focus escaped (e.g. the focused button became disabled) — pull it back.
      if (!(active instanceof HTMLElement) || !gate.contains(active)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey) {
        if (active === first || active === gate) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus();
    };
  }, []);

  const asked = askedId !== null ? queue.find(e => e.id === askedId) : undefined;
  const event = asked ?? queue[0];

  useEffect(() => {
    if (event && event.id !== askedId) setAskedId(event.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id]);

  // List view: freeze row order for the life of the gate. Ids keep their first-seen
  // position; newly-due doses append at the END so rows never shift under a tap.
  const orderRef = useRef<number[]>([]);
  const orderedQueue = useMemo(() => {
    const present = new Map(queue.map(e => [e.id, e]));
    const kept = orderRef.current.filter(id => present.has(id));
    const keptSet = new Set(kept);
    const order = [...kept, ...queue.filter(e => !keptSet.has(e.id)).map(e => e.id)];
    orderRef.current = order;
    return order.map(id => present.get(id)!);
  }, [queue]);

  const remaining = queue.length;

  /**
   * THE FIT SEARCH. After every paint that could change the column's height — a
   * new level, a different dose, a view change, a viewport change — measure the
   * rendered content against the space it has and step down one level if it
   * overflows. Two levels down is the floor; past that the screen would be
   * shrinking type on a medication confirmation, which is the wrong trade.
   *
   * Sits ABOVE the `if (!event)` return on purpose — a hook after a conditional
   * return is a hook that sometimes does not run.
   *
   * `useLayoutEffect` is the textbook choice for measure-then-adjust, but it warns
   * during SSR and this mounts on a server-rendered route. One frame at a too-tall
   * level is invisible next to a gate that never fits at all.
   */
  useEffect(() => {
    if (isElderly) return;
    const outer = containerRef.current;
    const inner = contentRef.current;
    if (!outer || !inner) return;
    // A couple of px of slack: sub-pixel rounding is not a reason to shrink the
    // one screen that has to stay readable.
    if (inner.scrollHeight > outer.clientHeight + 2 && level < 2) {
      const id = requestAnimationFrame(() => setLevel((l) => Math.min(2, l + 1)));
      return () => cancelAnimationFrame(id);
    }
  }, [level, viewportKey, isElderly, event?.id, remaining, view, flashIds.length]);

  if (!event) return null;

  /**
   * The three fits, as a TABLE — so the whole difference between roomy and tight
   * is readable in one place rather than scattered across a dozen ternaries.
   * Every value stays on the 8pt grid (spec §5); nothing here is a new token, a
   * new type size or a new radius, so the design freeze is untouched.
   *
   * Level 2 is the only one that shrinks a button, and only to `py-3 text-base`,
   * which still clears the 44px target with room. The drug name never shrinks.
   */
  const fit = isElderly ? 0 : level;
  const FIT = [
    { pad: 'pt-12 pb-6', gap: 'mt-5', tray: 'mt-8', emg: 'mt-6', btn: 'py-4 text-lg', ring: small ? 132 : 148, ringList: small ? 96 : 108 },
    { pad: 'pt-6 pb-4',  gap: 'mt-3', tray: 'mt-5', emg: 'mt-4', btn: 'py-4 text-lg', ring: small ? 104 : 116, ringList: small ? 84 : 92 },
    { pad: 'pt-4 pb-3',  gap: 'mt-2', tray: 'mt-4', emg: 'mt-3', btn: 'py-3 text-base', ring: small ? 80 : 88, ringList: small ? 68 : 74 },
  ] as const;

  const missedMode = isAttentionStatus(event.reminder_status);
  const med = event.medications;
  // Keep showing the list while a saved-row confirmation is still flashing.
  // Elderly never lists, whatever the toggle last held — the mode can change
  // under a mounted gate.
  const effectiveView = isElderly
    ? 'one'
    : remaining > 1 || flashIds.length > 0 ? view : 'one';

  // Theme-aware page gradient. The text inside uses semantic tokens that flip
  // to near-white in dark mode, so the background MUST flip with the app theme
  // too. Keyed off the app's .dark class via useTheme because this is a computed
  // multi-stop gradient passed as an inline style — there's no utility class to
  // hang a `dark:` variant on. (`dark:` itself is safe to use elsewhere: the
  // `@custom-variant dark` in globals.css binds it to the same .dark class.)
  // A flat base plus three oversized, heavily blurred colour fields (rendered below).
  // The old single radial washed one saturated colour across the whole screen; three
  // muted fields that overlap give the surface depth and a bit of colour movement
  // without ever competing with the one green button that matters.
  // The base is the app's own background token, not a hand-picked hex: an invented
  // navy read as a different product the moment it met the rest of the dark theme.
  // Mood comes from the colour fields instead, which are tints of the app's own
  // navy/pink family so the gate stays in the same world as everything behind it.
  const gateBase = 'var(--background)';
  const mesh =
    theme === 'dark'
      ? missedMode
        ? ['#5A2447', '#3E2470', '#1B2E6B']
        : ['#24378F', '#1B3A78', '#3A2A6B']
      : missedMode
        ? ['#F7CBCD', '#F8DFC9', '#E9D3E1']
        : ['#F7CCDB', '#CBDCF2', '#F6E3CA'];

  const answer = async (target: GateEvent, action: 'TAKEN' | 'SKIP', flash: boolean) => {
    if (busyId !== null) return;
    setBusyId(target.id);
    setError(null);
    try {
      const res = await resolveReminderEvent({
        supabase,
        eventId: target.id,
        medicationId: target.medication_id,
        scheduledFor: target.scheduled_for,
        action,
        actorRole: userRole,
      });
      if (flash) {
        setFlashIds(prev => [...prev, target.id]);
        setTimeout(() => {
          setFlashIds(prev => prev.filter(id => id !== target.id));
          onResolved(target.id, res.reminder_status);
        }, 700);
      } else {
        onResolved(target.id, res.reminder_status);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[MedDueGate] resolve failed:', message);
      const permanent = permanentResolveError(message);
      if (permanent) {
        // Retrying can never succeed — but do NOT advance yet. The dose stays
        // pinned with the honest message until the patient taps OK
        // (acknowledge-before-advance); only then does the parent drop it.
        setPermanentError({ id: target.id, message: permanent });
      } else {
        setError('Could not save that. Please try again.');
      }
    } finally {
      setBusyId(null);
    }
  };

  // OK tapped on an unsaveable dose: the patient has seen the message — NOW
  // the parent may drop it from the queue (advance, or unmount the gate).
  const acknowledgeUnsaveable = () => {
    if (!permanentError) return;
    onUnresolvable(permanentError.id);
    setPermanentError(null);
  };

  // One frame with no gate while the host resolves — it mounts on the client
  // anyway, and a gate that renders in the wrong containing block for a frame is
  // worse than one that renders a frame later.
  if (!portalHost) return null;

  return createPortal(
    <div
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Medication check"
      data-med-gate
      className="fixed inset-0 z-[120] flex flex-col overflow-y-auto outline-none"
      style={{ background: gateBase }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {mesh.map((c, i) => (
          <span
            key={i}
            className="absolute rounded-full"
            style={{
              background: c,
              filter: 'blur(72px)',
              opacity: theme === 'dark' ? 0.5 : 0.7,
              ...MESH_FIELDS[i],
            }}
          />
        ))}
      </div>

      {/* ONE GLANCE: QUESTION AND ANSWERS TOGETHER.
          `justify-center` with the content at its natural height, NOT a stretched
          column with the actions pinned to the bottom by `mt-auto`.

          The previous arrangement chased thumb reach — actions at the bottom of the
          viewport — and on a phone that put the medication name at the top, the
          buttons a full screen below it, and dead space between. The gate's whole
          job is "did you take this?" answerable in one look; a gate you have to
          SCROLL to answer has already failed at the only thing it does. Thumb reach
          is worth having, but not at the cost of the question and its answers being
          on the same screen.

          `flex-1` stays: it lets this column fill the fixed overlay so the content
          can centre inside it. What changed is that the content is now centred as
          one block instead of being pushed apart. */}
      <div
        ref={contentRef}
        className={`relative flex-1 flex flex-col items-center justify-center px-6 text-center ${FIT[fit].pad}`}
      >
      {remaining > 1 && (
        <span className="absolute top-6 text-xs font-mono font-bold text-muted-foreground tracking-widest">
          {remaining} doses to confirm
        </span>
      )}

      {/* The mascot used to be the biggest thing on a screen whose job is naming a
          drug — 168px of brain against a 24px medication name. It now sits inside
          the lateness ring at roughly a third of that, so the name can lead. */}
      {(() => {
        // Elderly's two values are deliberately untouched — it is excluded from
        // the redesign and its ring is sized for its own arm's-length scale.
        const ringSize =
          effectiveView === 'list'
            ? FIT[fit].ringList
            : isElderly
              ? (small ? 152 : 172)
              : FIT[fit].ring;
        const mood =
          missedMode || minutesLate(event.scheduled_for) >= 30 ? 'concerned' : 'reminder';
        return (
          <OverdueRing
            minutes={minutesLate(event.scheduled_for)}
            size={ringSize}
            missed={missedMode}
          >
            {/* The art has its own transparent margin, so the drawn brain reads a good
                deal smaller than its box — 0.78 fills the ring optically, not just
                geometrically. */}
            <BrainMascot size={Math.round(ringSize * 0.78)} mood={mood} />
          </OverdueRing>
        );
      })()}

      {/* View toggle — only when there is a queue worth batching. */}
      {remaining > 1 && (
        <div
          role="tablist"
          aria-label="Question view"
          className={`${FIT[fit].gap} inline-flex rounded-full border border-border bg-card p-1 shadow-sm`}
        >
          <button
            role="tab"
            aria-selected={effectiveView === 'one'}
            onClick={() => setView('one')}
            className={`px-4 rounded-full font-bold cursor-pointer transition-colors ${
              isElderly ? 'py-2.5 text-base' : 'py-1.5 text-xs'
            } ${
              effectiveView === 'one'
                ? 'bg-primary-strong text-primary-strong-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            One by one
          </button>
          <button
            role="tab"
            aria-selected={effectiveView === 'list'}
            onClick={() => setView('list')}
            className={`px-4 rounded-full font-bold cursor-pointer transition-colors ${
              isElderly ? 'py-2.5 text-base' : 'py-1.5 text-xs'
            } ${
              effectiveView === 'list'
                ? 'bg-primary-strong text-primary-strong-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            All at once
          </button>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-center gap-2 text-danger text-sm font-semibold">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {effectiveView === 'one' ? (
        <>
          {/* Lateness as a chip beside the ring, not a sentence. The tint says the
              same thing the arc does, and the figure is spelled out either way. */}
          <span
            className={`${FIT[fit].gap} inline-flex items-center gap-1.5 rounded-full font-bold ${
              missedMode ? 'bg-danger/15 text-danger-strong' : 'bg-warning/15 text-warning-strong'
            } ${isElderly ? 'px-4 py-2 text-base' : 'px-3 py-1.5 text-xs'}`}
          >
            <Clock className={isElderly ? 'w-5 h-5' : 'w-3.5 h-3.5'} />
            {overdueLabel(event.scheduled_for)}
          </span>

          {/* The question is the eyebrow; the DRUG NAME is the headline. The old markup
              split one sentence across two nodes with an icon wedged between them, so it
              rendered as two fragments in two different typefaces. */}
          <p className={`${FIT[fit].gap} font-semibold text-muted-foreground ${isElderly ? 'text-lg' : 'text-sm'}`}>
            {missedMode ? 'You missed' : 'Did you take'}
          </p>
          {/* Never truncate a drug name on the screen that asks you to confirm it:
              "Metformin Hydrochloride SR" must not become "Metformin Hydro…". */}
          <h1
            className={`mt-1 font-black text-foreground tracking-tight text-balance break-words max-w-[16ch] ${
              isElderly ? 'text-4xl' : 'text-3xl'
            }`}
          >
            {med.drug_name}
          </h1>
          {/* Rendered "1 tablet(s) · N/A" — the placeholder strength leaked through, on
              the one screen whose whole job is a clear yes/no about this dose. */}
          {(() => {
            const parts = [
              med.dosage_amount ? `${med.dosage_amount} ${unitPhrase(med.unit_type ?? undefined, med.dosage_amount)}` : '',
              med.dosage && med.dosage !== 'N/A' ? med.dosage : '',
              `scheduled ${fmtTime(event.scheduled_for)}`,
            ].filter(Boolean);
            return (
              <p
                className={`mt-2.5 flex flex-wrap items-center justify-center gap-1.5 text-muted-foreground font-sans ${
                  isElderly ? 'text-lg' : 'text-sm'
                }`}
              >
                <span className="text-primary shrink-0">
                  {getUnitIcon(med.unit_type ?? undefined, isElderly ? 'w-5 h-5' : 'w-4 h-4')}
                </span>
                {parts.join(' · ')}
              </p>
            );
          })()}

          {permanentError && permanentError.id === event.id ? (
            /* Unsaveable dose: honest message + explicit OK before it disappears. */
            <div className="mt-8 w-full max-w-sm space-y-3">
              <p className={`flex items-start justify-center gap-2 text-danger font-semibold ${isElderly ? 'text-lg' : 'text-sm'}`}>
                <AlertTriangle className={`shrink-0 mt-0.5 ${isElderly ? 'w-6 h-6' : 'w-4 h-4'}`} />
                <span>{permanentError.message}</span>
              </p>
              <button
                onClick={acknowledgeUnsaveable}
                className={`w-full flex items-center justify-center gap-2 rounded-2xl bg-card text-foreground border border-border font-black hover:bg-muted active:scale-[0.98] transition-all cursor-pointer ${
                  isElderly ? 'py-5 text-2xl' : FIT[fit].btn
                }`}
              >
                OK
              </button>
            </div>
          ) : (
          /* The actions sit on their own nested surface — an outer tray with a hairline,
             an inner glass plate inside it — so the answer area reads as a distinct
             object resting on the gate rather than three buttons floating on a wash.
             Radii are concentric: 32px outer, 32-6=26 inner, 16 on the buttons. */
          <div className={`${FIT[fit].tray} w-full max-w-sm`}>
            <div className="rounded-[2rem] p-1.5 bg-foreground/[0.04] dark:bg-white/[0.06] ring-1 ring-foreground/[0.06] dark:ring-white/10">
              <div className="rounded-[calc(2rem-0.375rem)] p-3 space-y-3 bg-card/70 dark:bg-white/[0.05] backdrop-blur-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]">
            <button
              onClick={() => answer(event, 'TAKEN', false)}
              disabled={busyId !== null}
              className={`w-full flex items-center justify-center gap-2 rounded-2xl bg-success text-success-foreground font-black shadow-[0_6px_16px_-6px_var(--success)] hover:bg-success/90 active:scale-[0.98] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] disabled:opacity-50 cursor-pointer ${
                isElderly ? 'py-5 text-2xl' : FIT[fit].btn
              }`}
            >
              <Check className={isElderly ? 'w-7 h-7' : 'w-5 h-5'} />
              {missedMode ? 'Yes, I took it late' : 'Yes, I took it'}
            </button>
            <button
              onClick={() => answer(event, 'SKIP', false)}
              disabled={busyId !== null}
              className={`w-full flex items-center justify-center gap-2 rounded-2xl bg-card text-foreground border border-border font-black hover:bg-muted active:scale-[0.98] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] disabled:opacity-50 cursor-pointer ${
                isElderly ? 'py-5 text-2xl' : FIT[fit].btn
              }`}
            >
              <X className={isElderly ? 'w-7 h-7' : 'w-5 h-5'} />
              {missedMode ? 'No, I missed it' : 'No, skip this dose'}
            </button>
            <button
              onClick={() => busyId === null && onSnooze(event.id)}
              disabled={busyId !== null}
              /* Was text-muted-foreground — the faintest text on the screen, for an
                 action that writes to the dose ledger. Quiet is fine; illegible is not. */
              className={`w-full flex items-center justify-center gap-2 min-h-11 rounded-2xl text-foreground hover:bg-foreground/5 font-semibold transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] disabled:opacity-50 cursor-pointer ${
                isElderly ? 'py-3 text-lg' : 'py-2.5 text-sm'
              }`}
            >
              <Clock className="w-4 h-4" />
              {missedMode ? 'Ask me later' : 'Not yet, remind me later'}
            </button>
              </div>
            </div>
          </div>
          )}
        </>
      ) : (
        <>
          <h1 className={`mt-5 font-black text-foreground tracking-tight ${isElderly ? 'text-3xl' : 'text-2xl'}`}>
            Confirm your doses
          </h1>
          <p className={`mt-1 font-semibold text-muted-foreground ${isElderly ? 'text-lg' : 'text-sm'}`}>
            Tap Taken or Skipped for each one.
          </p>

          <div className="mt-6 w-full max-w-md space-y-2 text-left">
            {orderedQueue.map(q => {
              const qMissed = isAttentionStatus(q.reminder_status);
              const saved = flashIds.includes(q.id);
              return (
                <div
                  key={q.id}
                  className="flex flex-wrap items-center justify-between gap-3 card-lift card-lift-2 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className={`font-black text-foreground truncate ${isElderly ? 'text-xl' : 'text-sm'}`}>
                      {q.medications.drug_name}
                    </p>
                    <p
                      className={`font-semibold ${qMissed ? 'text-danger' : 'text-muted-foreground'} ${
                        isElderly ? 'text-base' : 'text-xs'
                      }`}
                    >
                      {fmtTime(q.scheduled_for)}
                      {qMissed ? ' · missed' : ''}
                    </p>
                  </div>
                  {saved ? (
                    <span className={`flex items-center gap-1 text-success font-black ${isElderly ? 'text-lg' : 'text-sm'}`}>
                      <Check className="w-4 h-4" /> Saved
                    </span>
                  ) : permanentError && permanentError.id === q.id ? (
                    /* Unsaveable dose: honest message + explicit OK before the row goes. */
                    <div className="flex items-center gap-3 min-w-0">
                      <p className={`text-danger font-semibold ${isElderly ? 'text-base' : 'text-xs'}`}>
                        {permanentError.message}
                      </p>
                      <button
                        onClick={acknowledgeUnsaveable}
                        className={`shrink-0 min-h-11 rounded-xl bg-card border border-border text-foreground font-black px-3 hover:bg-muted active:scale-[0.97] transition-all cursor-pointer ${
                          isElderly ? 'py-3 text-lg' : 'py-2 text-xs'
                        }`}
                      >
                        OK
                      </button>
                    </div>
                  ) : busyId === q.id ? (
                    /* Only THIS row is saving — say so, instead of silently dimming every row. */
                    <span className={`font-semibold text-muted-foreground ${isElderly ? 'text-lg' : 'text-sm'}`}>
                      Saving…
                    </span>
                  ) : (
                    /* Opposing actions that write the dose ledger: ≥44px touch
                       targets and a wider gap in BOTH modes so a mis-tap can't
                       log the opposite of what the patient meant. */
                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        onClick={() => answer(q, 'TAKEN', true)}
                        disabled={busyId !== null}
                        className={`flex items-center gap-1 min-h-11 rounded-xl bg-success text-success-foreground font-black px-3 shadow-sm hover:bg-success/90 active:scale-[0.97] transition-all disabled:opacity-50 cursor-pointer ${
                          isElderly ? 'py-3 text-lg' : 'py-2 text-xs'
                        }`}
                      >
                        <Check className="w-4 h-4" /> Taken
                      </button>
                      <button
                        onClick={() => answer(q, 'SKIP', true)}
                        disabled={busyId !== null}
                        className={`flex items-center gap-1 min-h-11 rounded-xl bg-card border border-border text-foreground font-black px-3 hover:bg-muted active:scale-[0.97] transition-all disabled:opacity-50 cursor-pointer ${
                          isElderly ? 'py-3 text-lg' : 'py-2 text-xs'
                        }`}
                      >
                        <X className="w-4 h-4" /> Skipped
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button
            onClick={() => busyId === null && flashIds.length === 0 && onSnoozeAll()}
            disabled={busyId !== null || flashIds.length > 0}
            className={`mt-4 flex items-center justify-center gap-2 min-h-11 rounded-2xl text-muted-foreground hover:text-foreground font-semibold transition-all disabled:opacity-50 cursor-pointer ${
              isElderly ? 'py-3 text-lg' : 'py-2.5 text-sm'
            }`}
          >
            <Clock className="w-4 h-4" /> Ask me later
          </button>
        </>
      )}

      {/* Safety carve-out: the emergency card is always reachable, even mid-gate. */}
      <button
        onClick={() => router.push('/emergency')}
        className={`${FIT[fit].emg} inline-flex items-center justify-center gap-1.5 min-h-11 px-3 text-xs font-bold text-danger-strong hover:text-danger transition-colors cursor-pointer`}
      >
        <Siren className="w-3.5 h-3.5" /> Emergency card
      </button>
      </div>
    </div>,
    portalHost,
  );
}
