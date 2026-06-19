'use client';

import React, { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { resolveReminderEvent } from '@/lib/reminder-events';
import { useUiMode } from '@/context/ui-mode-context';
import { getUnitIcon } from '@/components/ui/custom-icons';
import { Check, X, AlertTriangle } from 'lucide-react';
import BrainMascot from './brain-mascot';

interface GateEvent {
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
  dueEvents: GateEvent[];
  userRole: 'PATIENT' | 'CAREGIVER';
  onResolved: (eventId: number, newStatus: string) => void;
  onComplete: () => void;
}

function overdueLabel(scheduledFor: string): string {
  const mins = Math.floor((Date.now() - new Date(scheduledFor).getTime()) / 60000);
  if (mins < 1) return 'due now';
  if (mins < 60) return `${mins} min overdue`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m overdue` : `${h}h overdue`;
}

export default function MedDueGate({ dueEvents, userRole, onResolved, onComplete }: MedDueGateProps) {
  const supabase = createClient();
  const { isElderly } = useUiMode();
  // Snapshot the queue once so it doesn't shift as the parent's data updates.
  const [queue] = useState<GateEvent[]>(dueEvents);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = queue[index];
  if (!current) return null;

  const total = queue.length;
  const med = current.medications;
  const timeStr = new Date(current.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const answer = async (action: 'TAKEN' | 'SKIP') => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await resolveReminderEvent({
        supabase,
        eventId: current.id,
        medicationId: current.medication_id,
        scheduledFor: current.scheduled_for,
        action,
        actorRole: userRole,
      });
      onResolved(current.id, res.reminder_status);
      if (index + 1 >= total) {
        onComplete();
      } else {
        setIndex((i) => i + 1);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[MedDueGate] resolve failed:', message);
      setError('Could not save that. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Medication check"
      className="fixed inset-0 z-[120] flex flex-col items-center justify-center px-6 py-10 text-center overflow-y-auto"
      style={{
        background:
          'radial-gradient(120% 90% at 50% 0%, #FDEEF2 0%, #F8F9FB 55%, #EAF3FF 100%)',
      }}
    >
      {total > 1 && (
        <span className="absolute top-6 text-xs font-mono font-bold text-muted-foreground tracking-widest">
          {index + 1} of {total}
        </span>
      )}

      <BrainMascot size={isElderly ? 200 : 168} mood="asking" />

      <p className={`mt-6 font-semibold text-muted-foreground ${isElderly ? 'text-lg' : 'text-sm'}`}>
        {overdueLabel(current.scheduled_for)} · scheduled {timeStr}
      </p>

      <h1 className={`mt-2 font-black text-foreground tracking-tight ${isElderly ? 'text-3xl' : 'text-2xl'}`}>
        Did you take your
      </h1>
      <div className="mt-2 flex items-center justify-center gap-2 max-w-[90vw]">
        <span className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          {getUnitIcon(med.unit_type ?? undefined, 'w-5 h-5')}
        </span>
        <span className={`font-black text-primary tracking-tight truncate ${isElderly ? 'text-3xl' : 'text-2xl'}`}>
          {med.drug_name}?
        </span>
      </div>
      {(med.dosage_amount || med.dosage) && (
        <p className={`mt-2 text-muted-foreground font-sans ${isElderly ? 'text-base' : 'text-sm'}`}>
          {med.dosage_amount ? `${med.dosage_amount} ${med.unit_type?.toLowerCase() || 'unit'}(s)` : ''}
          {med.dosage_amount && med.dosage ? ' · ' : ''}
          {med.dosage || ''}
        </p>
      )}

      {error && (
        <div className="mt-4 flex items-center gap-2 text-danger text-sm font-semibold">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      <div className="mt-8 w-full max-w-sm space-y-3">
        <button
          onClick={() => answer('TAKEN')}
          disabled={busy}
          className={`w-full flex items-center justify-center gap-2 rounded-2xl bg-success text-success-foreground font-black shadow-md hover:bg-success/90 active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer ${
            isElderly ? 'py-5 text-2xl' : 'py-4 text-lg'
          }`}
        >
          <Check className={isElderly ? 'w-7 h-7' : 'w-5 h-5'} /> Yes, I took it
        </button>
        <button
          onClick={() => answer('SKIP')}
          disabled={busy}
          className={`w-full flex items-center justify-center gap-2 rounded-2xl bg-card text-foreground border border-border font-black hover:bg-muted active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer ${
            isElderly ? 'py-5 text-2xl' : 'py-4 text-lg'
          }`}
        >
          <X className={isElderly ? 'w-7 h-7' : 'w-5 h-5'} /> No, skip this dose
        </button>
      </div>
    </div>
  );
}
