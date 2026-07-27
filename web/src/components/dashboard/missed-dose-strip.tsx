'use client';

import React, { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { resolveReminderEvent } from '@/lib/reminder-events';
import { useUiMode } from '@/context/ui-mode-context';
import { AlertTriangle, Check, X } from 'lucide-react';
import type { ReminderEvent } from '@/components/dashboard/todays-schedule';

interface MissedDoseStripProps {
  /** Attention-status events (MISSED / PENDING_REVIEW / UNCONFIRMED), oldest first. */
  events: ReminderEvent[];
  userRole: 'PATIENT' | 'CAREGIVER';
  onResolved: (eventId: number, newStatus: string) => void;
}

/**
 * Pinned to the very top of the dashboard in every layout. No dismiss –
 * resolving each dose is the only way to clear it (snoozing the gate merely
 * defers the question, never this strip).
 */
export default function MissedDoseStrip({ events, userRole, onResolved }: MissedDoseStripProps) {
  const supabase = createClient();
  const { isElderly } = useUiMode();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [failedId, setFailedId] = useState<number | null>(null);

  if (events.length === 0) return null;

  const resolve = async (event: ReminderEvent, action: 'TAKEN' | 'SKIP') => {
    if (busyId !== null) return;
    setBusyId(event.id);
    setFailedId(null);
    try {
      const res = await resolveReminderEvent({
        supabase,
        eventId: event.id,
        medicationId: event.medication_id,
        scheduledFor: event.scheduled_for,
        action,
        actorRole: userRole,
      });
      onResolved(event.id, res.reminder_status);
    } catch (err: unknown) {
      console.error('[MissedDoseStrip] resolve failed:', err instanceof Error ? err.message : String(err));
      setFailedId(event.id);
    } finally {
      setBusyId(null);
    }
  };

  const timeStr = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div
      role="alert"
      className="bg-danger/5 border-2 border-danger/30 rounded-3xl p-5 space-y-3 animate-fade-in"
    >
      <h2
        className={`flex items-center gap-2 font-black text-danger tracking-tight ${
          isElderly ? 'text-2xl' : 'text-base'
        }`}
      >
        <AlertTriangle className={isElderly ? 'w-7 h-7 shrink-0' : 'w-5 h-5 shrink-0'} />
        {events.length === 1 ? '1 missed dose' : `${events.length} missed doses`}
      </h2>

      <ul className="space-y-2">
        {events.map(e => (
          <li
            key={e.id}
            className="flex flex-wrap items-center justify-between gap-3 bg-card border border-border rounded-2xl px-4 py-3"
          >
            <div className="min-w-0">
              <p className={`font-black text-foreground truncate ${isElderly ? 'text-xl' : 'text-sm'}`}>
                {e.medications.drug_name}
              </p>
              <p className={`font-semibold text-muted-foreground ${isElderly ? 'text-base' : 'text-xs'}`}>
                {timeStr(e.scheduled_for)}
                {failedId === e.id && (
                  <span className="text-danger"> · Could not save, try again</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => resolve(e, 'TAKEN')}
                disabled={busyId !== null}
                className={`flex items-center gap-1.5 rounded-xl bg-success text-success-foreground font-black px-3 shadow-sm hover:bg-success/90 active:scale-[0.97] transition-all disabled:opacity-50 cursor-pointer ${
                  isElderly ? 'py-3 text-lg' : 'py-2 text-xs'
                }`}
              >
                <Check className="w-4 h-4" /> Took it
              </button>
              <button
                onClick={() => resolve(e, 'SKIP')}
                disabled={busyId !== null}
                className={`flex items-center gap-1.5 rounded-xl bg-card border border-border text-foreground font-black px-3 hover:bg-muted active:scale-[0.97] transition-all disabled:opacity-50 cursor-pointer ${
                  isElderly ? 'py-3 text-lg' : 'py-2 text-xs'
                }`}
              >
                <X className="w-4 h-4" /> Missed it
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
