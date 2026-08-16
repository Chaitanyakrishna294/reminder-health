'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Package, X, Plus } from 'lucide-react';
import { daysOfStockLeft } from '@/lib/medications/stock';

interface StockMed {
  id: number;
  drug_name: string;
  current_stock?: number | null;
  tablet_count?: number | null;
  stock_threshold?: number | null;
  frequency?: string | null;
  dosage_amount?: number | null;
  unit_type?: string | null;
  active?: boolean;
}

/**
 * The console's "Lowest Stock" stat, upgraded from a read-out to a control.
 *
 * The case it serves: an elderly patient whose caregiver manages refills, so the
 * patient never has to edit stock numbers themselves and cannot get them wrong.
 * Tapping the card opens the patient's medications sorted lowest-first, each with an
 * add-stock action. The write goes through /api/care/patient-stock, which re-checks
 * can_edit_medications against the live connection on every call — this component
 * only decides what to SHOW, never what is allowed.
 */
export default function PatientStockCard({
  medications,
  minDays,
  canEdit,
}: {
  medications: StockMed[];
  minDays: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  // Server-confirmed stock values, so the sheet reflects a refill immediately while
  // router.refresh() recomputes the page's own stats in the background.
  const [localStock, setLocalStock] = useState<Record<number, number>>({});

  const stockOf = (m: StockMed) => localStock[m.id] ?? Number(m.current_stock ?? m.tablet_count ?? 0);

  const rows = medications
    .filter(m => m.active !== false)
    .map(m => ({
      med: m,
      stock: stockOf(m),
      days: daysOfStockLeft({ ...m, current_stock: stockOf(m) }),
    }))
    // Lowest first: the medication this card exists to surface leads the list.
    .sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity));

  const lowCutoff = 3;

  const submit = async (medId: number) => {
    const amount = Number(amounts[medId]);
    setBusyId(medId);
    setError(null);
    try {
      const res = await fetch('/api/care/patient-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medicationId: medId, amount }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || 'Could not update stock.');
        return;
      }
      setLocalStock(prev => ({ ...prev, [medId]: body.newStock }));
      setAmounts(prev => ({ ...prev, [medId]: '' }));
      setSavedId(medId);
      setTimeout(() => setSavedId(null), 2000);
      // Recomputes minStockDaysRemaining and the rest of the server-rendered stats.
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusyId(null);
    }
  };

  const card = (
    <>
      <div>
        <span className="text-[10px] text-muted-foreground font-bold tracking-wider uppercase">Lowest Stock</span>
        <h3 className="text-3xl font-extrabold text-foreground mt-1.5">{minDays} Days</h3>
      </div>
      <div className={`text-[10px] font-bold mt-3 flex items-center gap-1.5 px-2 py-1 rounded-md w-max border ${
        minDays <= lowCutoff
          ? 'text-danger-strong bg-danger/10 border-danger/20'
          : 'text-muted-foreground bg-muted border-border'
      }`}>
        <Package className="w-3.5 h-3.5" />
        {/* The label says what tapping does, instead of the old "Refill Remaining"
            noun pile that named neither the number above it nor any action. */}
        {canEdit ? 'Tap to refill' : 'Days of stock left'}
      </div>
    </>
  );

  if (!canEdit) {
    return (
      <div className="card-lift stagger-in p-5 flex flex-col justify-between">
        {card}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Lowest stock ${minDays} days. Open to refill this patient's medications.`}
        className="card-lift press-sink stagger-in p-5 flex flex-col justify-between text-left cursor-pointer"
      >
        {card}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm flex items-center justify-center p-4"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Refill this patient's stock"
            className="bg-card border border-border rounded-[22px] max-w-md w-full p-6 space-y-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">Refill stock</p>
                <p className="text-xs font-semibold text-muted-foreground mt-1 leading-relaxed">
                  The patient sees every refill in their notifications.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center bg-muted hover:bg-accent-surface text-foreground transition-all cursor-pointer"
              >
                <X className="w-4 h-4" strokeWidth={2.5} />
              </button>
            </div>

            {error && (
              <p className="text-[12px] font-bold text-danger-strong bg-danger/10 border border-danger/20 rounded-xl px-3 py-2">
                {error}
              </p>
            )}

            <ul className="space-y-2.5">
              {rows.map(({ med, stock, days }) => (
                <li key={med.id} className="rounded-2xl border border-border bg-card p-3 space-y-2">
                  <div className="flex items-baseline justify-between gap-3 min-w-0">
                    <span className="text-[13px] font-bold text-foreground truncate">{med.drug_name}</span>
                    <span className={`shrink-0 text-[11px] font-bold ${
                      days !== null && days <= lowCutoff ? 'text-danger-strong' : 'text-muted-foreground'
                    }`}>
                      {stock} left{days !== null ? ` · ${days} day${days === 1 ? '' : 's'}` : ''}
                    </span>
                  </div>
                  {savedId === med.id ? (
                    <p className="text-[12px] font-bold text-success-strong">Stock updated.</p>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        inputMode="numeric"
                        value={amounts[med.id] ?? ''}
                        onChange={(e) => setAmounts(prev => ({ ...prev, [med.id]: e.target.value }))}
                        placeholder="How many did you add?"
                        aria-label={`Units to add to ${med.drug_name}`}
                        className="flex-1 min-w-0 h-11 rounded-xl bg-muted border border-border px-3 text-[13px] font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                      />
                      <button
                        onClick={() => submit(med.id)}
                        disabled={busyId !== null || !Number(amounts[med.id])}
                        className="shrink-0 inline-flex items-center justify-center gap-1 h-11 px-4 rounded-xl font-black text-[12px] bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover disabled:opacity-50 transition-all cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
                        {busyId === med.id ? 'Adding…' : 'Add'}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
