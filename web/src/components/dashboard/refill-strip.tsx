'use client';

// Pinned near the top of the dashboard whenever a medication needs refilling.
//
// Modelled on MissedDoseStrip and deliberately NOT dismissible: "Remind me tomorrow"
// on the gate defers the interruption, not the fact. Running low is still true
// tomorrow, and a dashboard that shows a medication as fine when it is not is worse
// than a strip someone has learned to live with.
//
// Ranked BELOW MissedDoseStrip when both are present — a missed dose outranks a refill.
// Tone is `warning`, not `danger`: per docs/DESIGN_SYSTEM.md orange is the actionable
// warning and red is reserved for a missed dose.

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import { addStock } from '@/lib/medications/add-stock';
import { lowStockReasonText, type LowStockMed } from '@/lib/medications/stock';
import { unitPhrase } from '@/components/medications/medication-form-options';
import { PackagePlus, AlertTriangle } from 'lucide-react';

interface RefillStripProps {
  meds: LowStockMed[];
  /** False for a caregiver without can_edit_medications — show the facts, no input. */
  canEdit: boolean;
}

export default function RefillStrip({ meds, canEdit }: RefillStripProps) {
  const supabase = createClient();
  const router = useRouter();
  const { isElderly } = useUiMode();
  const [openId, setOpenId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (meds.length === 0) return null;

  const submit = async (med: LowStockMed) => {
    setBusyId(med.id);
    setError(null);
    try {
      await addStock({ supabase, medicationId: med.id, currentStock: med.stock, amount: Number(amount) });
      setOpenId(null);
      setAmount('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update stock.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section
      aria-label="Medications needing a refill"
      className={`bg-warning/10 border border-warning/30 rounded-3xl ${isElderly ? 'p-6 space-y-4' : 'p-4 space-y-3'}`}
    >
      <h2 className={`flex items-center gap-2 font-black text-warning-strong ${isElderly ? 'text-xl' : 'text-sm'}`}>
        <AlertTriangle className={isElderly ? 'w-6 h-6' : 'w-4 h-4'} aria-hidden="true" />
        {meds.length === 1 ? '1 medication needs a refill' : `${meds.length} medications need a refill`}
      </h2>

      {error && (
        <p className="text-xs font-semibold text-danger-strong bg-danger/10 border border-danger/25 rounded-xl px-3 py-2">
          {error}
        </p>
      )}

      <ul className="space-y-2">
        {meds.map((med) => {
          const unit = unitPhrase(med.unit_type ?? undefined, med.stock);
          return (
            <li key={med.id} className="bg-card border border-border rounded-2xl px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={`font-black text-foreground truncate ${isElderly ? 'text-lg' : 'text-sm'}`}>
                    {med.drug_name}
                  </p>
                  <p className={`text-muted-foreground ${isElderly ? 'text-base' : 'text-xs'}`}>
                    {lowStockReasonText(med, unit)}
                  </p>
                </div>

                {canEdit && (
                  <button
                    onClick={() => { setOpenId(openId === med.id ? null : med.id); setAmount(''); setError(null); }}
                    aria-expanded={openId === med.id}
                    aria-label={`Add stock for ${med.drug_name}`}
                    className={`shrink-0 inline-flex items-center gap-1.5 font-bold rounded-xl bg-card border border-border text-foreground hover:bg-muted transition-all cursor-pointer ${
                      isElderly ? 'h-14 px-5 text-base' : 'h-11 px-4 text-xs'
                    }`}
                  >
                    <PackagePlus className="w-4 h-4" aria-hidden="true" /> Refill
                  </button>
                )}
              </div>

              {canEdit && openId === med.id && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    inputMode="numeric"
                    autoFocus
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submit(med); }}
                    aria-label={`Units of ${med.drug_name} added`}
                    placeholder={`How many ${unit} did you add?`}
                    className={`flex-1 min-w-0 bg-background border border-input rounded-xl px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring ${
                      isElderly ? 'h-14 text-lg' : 'h-11 text-sm'
                    }`}
                  />
                  <button
                    onClick={() => submit(med)}
                    disabled={busyId === med.id}
                    className={`shrink-0 font-black rounded-xl bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover transition-all cursor-pointer disabled:opacity-50 ${
                      isElderly ? 'h-14 px-6 text-base' : 'h-11 px-4 text-xs'
                    }`}
                  >
                    {busyId === med.id ? 'Saving…' : 'Add'}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
