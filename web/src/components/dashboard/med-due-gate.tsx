'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { resolveReminderEvent } from '@/lib/reminder-events';
import { isAttentionStatus } from '@/lib/schedule/dose-attention';
import { useUiMode } from '@/context/ui-mode-context';
import { getUnitIcon } from '@/components/ui/custom-icons';
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

export default function MedDueGate({ queue, userRole, onResolved, onSnooze, onSnoozeAll }: MedDueGateProps) {
  const supabase = createClient();
  const router = useRouter();
  const { isElderly } = useUiMode();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [small, setSmall] = useState(false);
  // Session-local: every gate appearance starts back at one-by-one (safety default).
  const [view, setView] = useState<'one' | 'list'>('one');
  // List rows already saved, kept on screen briefly as confirmation before removal.
  const [flashIds, setFlashIds] = useState<number[]>([]);

  useEffect(() => {
    const f = () => setSmall(window.innerWidth < 420);
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);

  const event = queue[0];
  const remaining = queue.length;
  if (!event) return null;

  const missedMode = isAttentionStatus(event.reminder_status);
  const med = event.medications;
  // Keep showing the list while a saved-row confirmation is still flashing.
  const effectiveView = remaining > 1 || flashIds.length > 0 ? view : 'one';

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
      setError('Could not save that. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Medication check"
      className="fixed inset-0 z-[120] flex flex-col items-center justify-center px-6 py-10 text-center overflow-y-auto"
      style={{
        background: missedMode
          ? 'radial-gradient(120% 90% at 50% 0%, #FDE8EA 0%, #F8F9FB 55%, #FFF0EE 100%)'
          : 'radial-gradient(120% 90% at 50% 0%, #FDEEF2 0%, #F8F9FB 55%, #EAF3FF 100%)',
      }}
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
                ? 'bg-primary text-primary-foreground'
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
                ? 'bg-primary text-primary-foreground'
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
            <span className={`font-black text-primary tracking-tight truncate ${isElderly ? 'text-3xl' : 'text-2xl'}`}>
              {missedMode ? med.drug_name : `${med.drug_name}?`}
            </span>
          </div>
          {(med.dosage_amount || med.dosage) && (
            <p className={`mt-2 text-muted-foreground font-sans ${isElderly ? 'text-base' : 'text-sm'}`}>
              {med.dosage_amount ? `${med.dosage_amount} ${med.unit_type?.toLowerCase() || 'unit'}(s)` : ''}
              {med.dosage_amount && med.dosage ? ' · ' : ''}
              {med.dosage || ''}
            </p>
          )}
          {missedMode && (
            <h2 className={`mt-4 font-black text-foreground tracking-tight ${isElderly ? 'text-2xl' : 'text-xl'}`}>
              Did you take it?
            </h2>
          )}

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
              className={`w-full flex items-center justify-center gap-2 rounded-2xl text-muted-foreground hover:text-foreground font-semibold transition-all disabled:opacity-50 cursor-pointer ${
                isElderly ? 'py-3 text-lg' : 'py-2.5 text-sm'
              }`}
            >
              <Clock className="w-4 h-4" />
              {missedMode ? 'Ask me later' : 'Not yet, remind me later'}
            </button>
          </div>
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
            {queue.map(q => {
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
                  ) : (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => answer(q, 'TAKEN', true)}
                        disabled={busyId !== null}
                        className={`flex items-center gap-1 rounded-xl bg-success text-success-foreground font-black px-3 shadow-sm hover:bg-success/90 active:scale-[0.97] transition-all disabled:opacity-50 cursor-pointer ${
                          isElderly ? 'py-3 text-lg' : 'py-2 text-xs'
                        }`}
                      >
                        <Check className="w-4 h-4" /> Taken
                      </button>
                      <button
                        onClick={() => answer(q, 'SKIP', true)}
                        disabled={busyId !== null}
                        className={`flex items-center gap-1 rounded-xl bg-card border border-border text-foreground font-black px-3 hover:bg-muted active:scale-[0.97] transition-all disabled:opacity-50 cursor-pointer ${
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
            className={`mt-4 flex items-center justify-center gap-2 rounded-2xl text-muted-foreground hover:text-foreground font-semibold transition-all disabled:opacity-50 cursor-pointer ${
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
        className="mt-6 inline-flex items-center gap-1.5 text-xs font-bold text-danger/80 hover:text-danger transition-colors cursor-pointer"
      >
        <Siren className="w-3.5 h-3.5" /> Emergency card
      </button>
    </div>
  );
}
