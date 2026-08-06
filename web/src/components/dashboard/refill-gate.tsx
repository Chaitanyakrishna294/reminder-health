'use client';

// Full-screen "you need to refill" prompt on app open, the refill counterpart to
// MedDueGate.
//
// Two deliberate differences from MedDueGate:
//
// 1. The dose gate always wins. The parent only mounts this when the dose queue is
//    empty. A dose due now is time-critical and a refill is not, and stacking two
//    full-screen gates is how people learn to tap past both.
// 2. It lists every low medication at once rather than asking one at a time. The dose
//    gate asks individually because each answer is a separate medical fact; a refill
//    is one trip to the pharmacy.
//
// "Remind me tomorrow" is one snooze for all of them, not one per medication —
// per-med snoozes would re-gate the user the moment a second medication went low.

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import { addStock } from '@/lib/medications/add-stock';
import { lowStockReasonText, type LowStockMed } from '@/lib/medications/stock';
import { unitPhrase } from '@/components/medications/medication-form-options';
import { PackagePlus, Clock } from 'lucide-react';

interface RefillGateProps {
  meds: LowStockMed[];
  /** False for a caregiver without can_edit_medications. */
  canEdit: boolean;
  /** Persist "not now" until tomorrow and unmount. */
  onSnooze: () => void;
}

export default function RefillGate({ meds, canEdit, onSnooze }: RefillGateProps) {
  const supabase = createClient();
  const router = useRouter();
  const { isElderly } = useUiMode();
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [doneIds, setDoneIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const submit = async (med: LowStockMed) => {
    setBusyId(med.id);
    setError(null);
    try {
      await addStock({
        supabase,
        medicationId: med.id,
        currentStock: med.stock,
        amount: Number(amounts[med.id]),
      });
      const next = [...doneIds, med.id];
      setDoneIds(next);
      // Everything topped up — close and let the server re-read.
      if (next.length === meds.length) router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update stock.');
    } finally {
      setBusyId(null);
    }
  };

  const remaining = meds.filter((m) => !doneIds.includes(m.id));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Medications needing a refill"
      className="fixed inset-0 z-[110] overflow-y-auto bg-background flex flex-col items-center justify-center px-4 py-10"
    >
      <div className="w-full max-w-md space-y-5">
        <div className="text-center space-y-1">
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-muted-foreground">
            Before you carry on
          </p>
          <h1 className={`font-black tracking-tight text-foreground ${isElderly ? 'text-3xl' : 'text-2xl'}`}>
            {remaining.length === 1 ? 'One medication is running low' : `${remaining.length} medications are running low`}
          </h1>
          <p className={`text-muted-foreground ${isElderly ? 'text-lg' : 'text-sm'}`}>
            {canEdit
              ? 'Bought more? Add it here so the counts stay right.'
              : 'You can see this because you help manage these medications.'}
          </p>
        </div>

        {error && (
          <p className="text-xs font-semibold text-danger-strong bg-danger/10 border border-danger/25 rounded-xl px-3 py-2">
            {error}
          </p>
        )}

        <ul className="space-y-3">
          {remaining.map((med) => {
            const unit = unitPhrase(med.unit_type ?? undefined, med.stock);
            return (
              <li key={med.id} className="bg-card border border-border rounded-2xl p-4 space-y-3 shadow-sm">
                <div>
                  <p className={`font-black text-foreground ${isElderly ? 'text-xl' : 'text-base'}`}>
                    {med.drug_name}
                  </p>
                  <p className={`text-warning-strong font-semibold ${isElderly ? 'text-base' : 'text-xs'}`}>
                    {lowStockReasonText(med, unit)}
                  </p>
                </div>

                {canEdit ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={amounts[med.id] ?? ''}
                      onChange={(e) => setAmounts((p) => ({ ...p, [med.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') submit(med); }}
                      aria-label={`Units of ${med.drug_name} added`}
                      placeholder={`How many ${unit} did you add?`}
                      className={`flex-1 min-w-0 bg-background border border-input rounded-xl px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring ${
                        isElderly ? 'h-16 text-lg' : 'h-12 text-sm'
                      }`}
                    />
                    <button
                      onClick={() => submit(med)}
                      disabled={busyId === med.id}
                      className={`shrink-0 inline-flex items-center gap-1.5 font-black rounded-xl bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover transition-all cursor-pointer disabled:opacity-50 ${
                        isElderly ? 'h-16 px-6 text-lg' : 'h-12 px-5 text-sm'
                      }`}
                    >
                      <PackagePlus className="w-4 h-4" aria-hidden="true" />
                      {busyId === med.id ? 'Saving…' : 'Add'}
                    </button>
                  </div>
                ) : (
                  <p className={`text-muted-foreground ${isElderly ? 'text-base' : 'text-xs'}`}>
                    Ask them to refill — you do not have permission to edit their medications.
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        <button
          onClick={onSnooze}
          className={`w-full inline-flex items-center justify-center gap-2 font-bold rounded-2xl bg-card border border-border text-foreground hover:bg-muted transition-all cursor-pointer ${
            isElderly ? 'h-16 text-lg' : 'h-12 text-sm'
          }`}
        >
          <Clock className="w-4 h-4" aria-hidden="true" /> Remind me tomorrow
        </button>
      </div>
    </div>
  );
}
