'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { resolveReminderEvent } from '@/lib/reminder-events';
import { isAttentionStatus } from '@/lib/schedule/dose-attention';
import { useUiMode } from '@/context/ui-mode-context';
import { useTheme } from '@/context/theme-context';
import { getUnitIcon } from '@/components/ui/custom-icons';
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

export default function MedDueGate({ queue, userRole, onResolved, onSnooze, onSnoozeAll, onUnresolvable }: MedDueGateProps) {
  const supabase = createClient();
  const router = useRouter();
  const { isElderly } = useUiMode();
  const { theme } = useTheme();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [small, setSmall] = useState(false);
  // Session-local: every gate appearance starts back at one-by-one (safety default).
  const [view, setView] = useState<'one' | 'list'>('one');
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

  useEffect(() => {
    const f = () => setSmall(window.innerWidth < 420);
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
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
  if (!event) return null;

  const missedMode = isAttentionStatus(event.reminder_status);
  const med = event.medications;
  // Keep showing the list while a saved-row confirmation is still flashing.
  const effectiveView = remaining > 1 || flashIds.length > 0 ? view : 'one';

  // Theme-aware page gradient. The text inside uses semantic tokens that flip
  // to near-white in dark mode, so the background MUST flip with the app theme
  // too. Keyed off the app's .dark class via useTheme because this is a computed
  // multi-stop gradient passed as an inline style — there's no utility class to
  // hang a `dark:` variant on. (`dark:` itself is safe to use elsewhere: the
  // `@custom-variant dark` in globals.css binds it to the same .dark class.)
  const gateBackground =
    theme === 'dark'
      ? missedMode
        ? // Red-tinted deep navy (missed): danger mood, light text stays readable.
          'radial-gradient(120% 90% at 50% 0%, #47203A 0%, #0F1C5A 55%, #351430 100%)'
        : // Deep navy (due): mirrors --auth-radial's dark treatment.
          'radial-gradient(120% 90% at 50% 0%, #1E2E6E 0%, #0F1C5A 55%, #0A1340 100%)'
      : missedMode
        ? 'radial-gradient(120% 90% at 50% 0%, #FDE8EA 0%, #F8F9FB 55%, #FFF0EE 100%)'
        : 'radial-gradient(120% 90% at 50% 0%, #FDEEF2 0%, #F8F9FB 55%, #EAF3FF 100%)';

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

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Medication check"
      className="fixed inset-0 z-[120] flex flex-col items-center justify-center px-6 py-10 text-center overflow-y-auto outline-none"
      style={{ background: gateBackground }}
    >
      {remaining > 1 && (
        <span className="absolute top-6 text-xs font-mono font-bold text-muted-foreground tracking-widest">
          {remaining} doses to confirm
        </span>
      )}

      <BrainMascot
        size={
          effectiveView === 'list'
            ? (small ? 88 : 112)
            : isElderly ? (small ? 156 : 200) : (small ? 116 : 168)
        }
        mood={
          missedMode ||
          Math.floor((Date.now() - new Date(event.scheduled_for).getTime()) / 60000) >= 30
            ? 'concerned'
            : 'reminder'
        }
      />

      {/* View toggle — only when there is a queue worth batching. */}
      {remaining > 1 && (
        <div
          role="tablist"
          aria-label="Question view"
          className="mt-5 inline-flex rounded-full border border-border bg-card p-1 shadow-sm"
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
          <p className={`mt-5 font-semibold text-muted-foreground ${isElderly ? 'text-lg' : 'text-sm'}`}>
            {overdueLabel(event.scheduled_for)} · scheduled {fmtTime(event.scheduled_for)}
          </p>

          <h1 className={`mt-2 font-black text-foreground tracking-tight ${isElderly ? 'text-3xl' : 'text-2xl'}`}>
            {missedMode ? 'You missed your' : 'Did you take your'}
          </h1>
          <div className="mt-2 flex items-center justify-center gap-2 max-w-[90vw]">
            <span className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              {getUnitIcon(med.unit_type ?? undefined, 'w-5 h-5')}
            </span>
            {/* Was `text-primary` — brand pink on the gate's pale pink surface measures
                2.6:1, under the 3:1 floor even at this size. The pink stays on the icon
                tile beside it, where it is decoration rather than the thing you read. */}
            <span className={`font-black text-foreground tracking-tight truncate ${isElderly ? 'text-3xl' : 'text-2xl'}`}>
              {missedMode ? med.drug_name : `${med.drug_name}?`}
            </span>
          </div>
          {/* Rendered "1 tablet(s) · N/A" — the placeholder strength leaked through, on
              the one screen whose whole job is a clear yes/no about this dose. */}
          {(() => {
            const parts = [
              med.dosage_amount ? `${med.dosage_amount} ${unitPhrase(med.unit_type ?? undefined, med.dosage_amount)}` : '',
              med.dosage && med.dosage !== 'N/A' ? med.dosage : '',
            ].filter(Boolean);
            return parts.length > 0 ? (
              <p className={`mt-2 text-muted-foreground font-sans ${isElderly ? 'text-base' : 'text-sm'}`}>
                {parts.join(' · ')}
              </p>
            ) : null;
          })()}
          {missedMode && (
            <h2 className={`mt-4 font-black text-foreground tracking-tight ${isElderly ? 'text-2xl' : 'text-xl'}`}>
              Did you take it?
            </h2>
          )}

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
                  isElderly ? 'py-5 text-2xl' : 'py-4 text-lg'
                }`}
              >
                OK
              </button>
            </div>
          ) : (
          <div className="mt-8 w-full max-w-sm space-y-3">
            <button
              onClick={() => answer(event, 'TAKEN', false)}
              disabled={busyId !== null}
              className={`w-full flex items-center justify-center gap-2 rounded-2xl bg-success text-success-foreground font-black shadow-md hover:bg-success/90 active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer ${
                isElderly ? 'py-5 text-2xl' : 'py-4 text-lg'
              }`}
            >
              <Check className={isElderly ? 'w-7 h-7' : 'w-5 h-5'} />
              {missedMode ? 'Yes, I took it late' : 'Yes, I took it'}
            </button>
            <button
              onClick={() => answer(event, 'SKIP', false)}
              disabled={busyId !== null}
              className={`w-full flex items-center justify-center gap-2 rounded-2xl bg-card text-foreground border border-border font-black hover:bg-muted active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer ${
                isElderly ? 'py-5 text-2xl' : 'py-4 text-lg'
              }`}
            >
              <X className={isElderly ? 'w-7 h-7' : 'w-5 h-5'} />
              {missedMode ? 'No, I missed it' : 'No, skip this dose'}
            </button>
            <button
              onClick={() => busyId === null && onSnooze(event.id)}
              disabled={busyId !== null}
              className={`w-full flex items-center justify-center gap-2 min-h-11 rounded-2xl text-muted-foreground hover:text-foreground font-semibold transition-all disabled:opacity-50 cursor-pointer ${
                isElderly ? 'py-3 text-lg' : 'py-2.5 text-sm'
              }`}
            >
              <Clock className="w-4 h-4" />
              {missedMode ? 'Ask me later' : 'Not yet, remind me later'}
            </button>
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
                  className="flex flex-wrap items-center justify-between gap-3 bg-card border border-border rounded-2xl px-4 py-3 shadow-sm"
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
        className="mt-6 inline-flex items-center justify-center gap-1.5 min-h-11 px-3 text-xs font-bold text-danger-strong hover:text-danger transition-colors cursor-pointer"
      >
        <Siren className="w-3.5 h-3.5" /> Emergency card
      </button>
    </div>
  );
}
