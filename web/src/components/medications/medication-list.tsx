'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { calculateNextReminder } from '@/lib/medication-utils';
import { useUiMode } from '@/context/ui-mode-context';
import { Plus, Package, Clock, Pause, Play, SquarePen, Trash2, Pill, X } from 'lucide-react';
import GuideButton from '@/components/guide/guide-button';
import { getUnitIcon } from '@/components/ui/custom-icons';
import { getSeverityTheme } from '@/lib/severity-theme';

export interface Medication {
  id: number;
  telegram_id: string;
  drug_name: string;
  dosage: string;
  frequency: string;
  reminder_times: string[];
  tablet_count: number;
  priority_level: string;
  next_reminder_at: string | null;
  active: boolean;
  unit_type?: string;
  dosage_amount?: number;
  current_stock?: number | null;
  stock_threshold?: number | null;
  medication_reason?: string | null;
  timezone?: string | null;
}

interface MedicationListProps {
  initialMeds: Medication[];
  targetTelegramChatId: string;
  myTelegramChatId: string;
  userRole: 'PATIENT' | 'CAREGIVER';
  patientName?: string;
}

export default function MedicationList({
  initialMeds,
  targetTelegramChatId,
  myTelegramChatId,
  userRole,
  patientName,
}: MedicationListProps) {
  const [meds, setMeds] = useState<Medication[]>(initialMeds);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [stockBusyId, setStockBusyId] = useState<number | null>(null);

  // In-app dialog state (native prompt/confirm/alert are blocked in sandboxed frames).
  const [stockModalMed, setStockModalMed] = useState<Medication | null>(null);
  const [stockInput, setStockInput] = useState('');
  const [stockError, setStockError] = useState('');
  const [deleteModalMed, setDeleteModalMed] = useState<Medication | null>(null);

  // Whether the viewer can edit stock: only on their own medications.
  const isOwnMeds = targetTelegramChatId === myTelegramChatId;

  const openStockModal = (med: Medication) => {
    setStockModalMed(med);
    setStockInput('');
    setStockError('');
  };

  // Refill: add the entered amount to current_stock (source of truth; a DB trigger
  // syncs tablet_count). Mirrors the Telegram /refill flow.
  const confirmAddStock = async () => {
    if (!stockModalMed) return;
    const med = stockModalMed;
    const amount = Number(stockInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      setStockError('Please enter a positive number.');
      return;
    }
    setStockBusyId(med.id);
    setStockError('');
    try {
      const newStock = Number(med.current_stock || 0) + amount;
      const { error } = await supabase
        .from('medications')
        .update({ current_stock: newStock })
        .eq('id', med.id);
      if (error) throw error;
      setMeds(prev => prev.map(m => m.id === med.id ? { ...m, current_stock: newStock } : m));
      setStockModalMed(null);
    } catch (err: any) {
      console.error('[Medications] add stock failed:', err);
      setStockError('Could not update stock. Please try again.');
    } finally {
      setStockBusyId(null);
    }
  };
  const [mounted, setMounted] = useState(false);
  
  const supabase = createClient();
  const router = useRouter();
  const { isElderly, viewMode } = useUiMode();
  const activeRole = viewMode === 'PATIENT_MONITOR' ? 'CAREGIVER' : 'PATIENT';

  useEffect(() => {
    setMounted(true);
  }, []);

  // Dynamic loader that refreshes medications when changing active role views
  useEffect(() => {
    async function fetchMeds() {
      if (userRole === 'CAREGIVER') {
        const queryId = activeRole === 'PATIENT' ? myTelegramChatId : targetTelegramChatId;
        if (!queryId) {
          setMeds([]);
          return;
        }

        const { data, error } = await supabase
          .from('medications')
          .select('id, telegram_id, drug_name, dosage, frequency, reminder_times, tablet_count, priority_level, next_reminder_at, active, unit_type, dosage_amount, current_stock, stock_threshold, medication_reason')
          .eq('telegram_id', queryId);

        if (!error && data) {
          setMeds(data as Medication[]);
        }
      } else {
        setMeds(initialMeds);
      }
    }
    if (mounted) {
      fetchMeds();
    }
  }, [activeRole, userRole, myTelegramChatId, targetTelegramChatId, supabase, mounted, initialMeds]);

  const handleToggleActive = async (med: Medication) => {
    setLoadingId(med.id);
    try {
      const newActive = !med.active;
      let nextReminder: string | null = null;

      if (newActive && med.reminder_times.length > 0) {
        // Recalculate next reminder when resuming, in the med's OWN timezone
        // (recomputing without it silently shifts non-IST medications to IST).
        const nextDate = calculateNextReminder(med.reminder_times, med.timezone ?? undefined);
        nextReminder = nextDate.toISOString();
      }

      const { error } = await supabase
        .from('medications')
        .update({
          active: newActive,
          next_reminder_at: nextReminder,
        })
        .eq('id', med.id);

      if (error) throw error;

      setMeds((prev) =>
        prev.map((m) =>
          m.id === med.id
            ? { ...m, active: newActive, next_reminder_at: nextReminder }
            : m
        )
      );
      router.refresh();
    } catch (err) {
      console.error('[MedList] Error toggling active status:', err);
    } finally {
      setLoadingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteModalMed) return;
    const medId = deleteModalMed.id;
    setLoadingId(medId);
    try {
      // Hard delete from database so it completely disappears from the web manager
      const { error } = await supabase
        .from('medications')
        .delete()
        .eq('id', medId);

      if (error) throw error;

      // Remove from local listing
      setMeds((prev) => prev.filter((m) => m.id !== medId));
      setDeleteModalMed(null);
      router.refresh();
    } catch (err) {
      console.error('[MedList] Error deleting medication:', err);
    } finally {
      setLoadingId(null);
    }
  };

  const format12Hour = (timeStr: string) => {
    const [hourStr, minStr] = timeStr.split(':');
    const hour = parseInt(hourStr);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 === 0 ? 12 : hour % 12;
    return `${displayHour}:${minStr} ${ampm}`;
  };

  const activeMeds = meds.filter(m => m.active);
  const pausedMeds = meds.filter(m => !m.active);

  // Apple Health-style category colors — vibrant accent on clean white.
  const cardTheme = (med: Medication) => {
    if (!med.active) return { color: '#8E8E93', tint: '#F2F2F7' };
    if (med.priority_level === 'critical') return { color: '#FF3B30', tint: '#FFECEA' }; // system red
    if (med.priority_level === 'important') return { color: '#FF9500', tint: '#FFF3E0' }; // system orange
    return { color: '#F26B8A', tint: '#FFEDF2' }; // app pink
  };

  const cardShadow = '0 1px 3px rgba(16, 28, 90, 0.04), 0 10px 30px rgba(16, 28, 90, 0.06)';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div data-tour="med-hero" className="flex items-end justify-between gap-3">
        <div>
          <h1 className={`font-bold tracking-tight text-foreground ${isElderly ? 'text-[28px]' : 'text-[26px]'}`}>
            {patientName ? `${patientName}'s Medications` : 'Medications'}
          </h1>
          <p className={`text-muted-foreground mt-0.5 font-medium ${isElderly ? 'text-base' : 'text-[13px]'}`}>
            {activeMeds.length} active{pausedMeds.length > 0 ? ` · ${pausedMeds.length} paused` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <GuideButton tour="medications" />
          {activeRole !== 'CAREGIVER' && (
            <Link
              href="/medications/new"
              aria-label="Add medication"
              className={`inline-flex items-center gap-1.5 font-semibold rounded-full bg-primary text-white hover:bg-primary-hover transition-all ${
                isElderly ? 'px-5 py-2.5 text-base' : 'px-4 py-2 text-[13px]'
              }`}
              style={{ boxShadow: '0 4px 12px rgba(242, 107, 138, 0.35)' }}
            >
              <Plus className="w-4 h-4 shrink-0" strokeWidth={2.5} />
              Add
            </Link>
          )}
        </div>
      </div>

      {/* Cards */}
      {meds.length === 0 ? (
        <div
          className="bg-white rounded-[22px] text-center text-muted-foreground p-12 text-sm"
          style={{ boxShadow: cardShadow }}
        >
          No medications yet. Tap &quot;Add&quot; to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {meds.map((med, idx) => {
            const isLoading = loadingId === med.id;
            const isLowStock = med.current_stock !== null
              && med.current_stock !== undefined
              && med.stock_threshold !== null
              && med.stock_threshold !== undefined
              && Number(med.current_stock) <= Number(med.stock_threshold);
            const t = cardTheme(med);
            const stockColor = isLowStock ? '#FF3B30' : t.color;

            return (
              <div
                key={med.id}
                data-tour={idx === 0 ? 'med-card-first' : undefined}
                className={`relative bg-white rounded-[22px] overflow-hidden transition-all duration-200 hover:-translate-y-0.5 ${!med.active ? 'opacity-70' : ''}`}
                style={{ boxShadow: cardShadow }}
              >
                {/* Header region */}
                <div className="px-5 pt-5 pb-4">
                  <div className="flex items-start gap-3.5">
                    {/* Icon tile */}
                    <div
                      className={`shrink-0 rounded-2xl flex items-center justify-center ${isElderly ? 'w-14 h-14' : 'w-12 h-12'}`}
                      style={{ background: t.tint, color: t.color }}
                    >
                      {getUnitIcon(med.unit_type, isElderly ? 'w-7 h-7' : 'w-6 h-6')}
                    </div>

                    {/* Name + meta */}
                    <div className="flex-1 min-w-0">
                      <h3
                        className={`font-bold tracking-tight text-foreground truncate ${isElderly ? 'text-2xl' : 'text-lg'}`}
                      >
                        {med.drug_name}
                      </h3>
                      <p className={`text-muted-foreground font-medium mt-0.5 ${isElderly ? 'text-base' : 'text-[13px]'}`}>
                        {med.dosage_amount || 1} {med.unit_type?.toLowerCase() || 'tablet'}(s)
                        {med.dosage && med.dosage !== 'N/A' && <> · {med.dosage}</>}
                      </p>
                      {/* Category + frequency pills */}
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <span
                          className="inline-flex items-center gap-1 font-semibold capitalize rounded-full px-2.5 py-1 text-[11px]"
                          style={{ background: t.tint, color: t.color }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.color }} />
                          {med.priority_level}
                        </span>
                        <span className="inline-flex items-center font-semibold capitalize rounded-full px-2.5 py-1 text-[11px] bg-[#F2F2F7] text-muted-foreground">
                          {med.frequency.replace(/_/g, ' ')}
                        </span>
                        {!med.active && (
                          <span className="inline-flex items-center font-semibold rounded-full px-2.5 py-1 text-[11px] bg-[#F2F2F7] text-muted-foreground">
                            Paused
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Stock */}
                    <div data-tour={idx === 0 ? 'med-stock' : undefined} className="shrink-0 text-right">
                      {med.current_stock !== null && med.current_stock !== undefined ? (
                        <>
                          <p
                            className={`font-bold tabular-nums leading-none ${isElderly ? 'text-4xl' : 'text-[32px]'} ${isLowStock ? 'animate-pulse' : ''}`}
                            style={{ color: stockColor }}
                          >
                            {med.current_stock}
                          </p>
                          <p className="font-semibold text-[10px] uppercase tracking-wide mt-1 text-muted-foreground">
                            {isLowStock ? 'Low' : 'left'}
                          </p>
                        </>
                      ) : (
                        <Package className="w-5 h-5 text-muted-foreground/40 mt-1" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Divider */}
                <div className="h-px bg-[#0F1C5A]/[0.06] mx-5" />

                {/* Footer region */}
                <div className="px-5 py-3.5 flex items-center justify-between gap-3">
                  {/* Times */}
                  <div data-tour={idx === 0 ? 'med-times' : undefined} className="flex items-center gap-1.5 flex-wrap min-w-0">
                    {med.reminder_times.map((time, ti) => (
                      <span
                        key={ti}
                        className={`inline-flex items-center gap-1 font-semibold rounded-full ${
                          isElderly ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-1 text-[11px]'
                        }`}
                        style={{ background: t.tint, color: t.color }}
                      >
                        <Clock className="w-3 h-3 shrink-0" strokeWidth={2.5} />
                        {format12Hour(time)}
                      </span>
                    ))}
                  </div>

                  {/* Actions */}
                  {activeRole !== 'CAREGIVER' && (
                    <div data-tour={idx === 0 ? 'med-actions' : undefined} className="flex items-center gap-1.5 shrink-0">
                      {isOwnMeds && (
                        <button
                          onClick={() => openStockModal(med)}
                          disabled={stockBusyId === med.id}
                          title="Add stock"
                          className="w-9 h-9 rounded-full flex items-center justify-center bg-[#F2F2F7] text-foreground/70 hover:bg-[#E5E5EA] transition-all cursor-pointer disabled:opacity-50"
                        >
                          {stockBusyId === med.id
                            ? <span className="text-[10px]">…</span>
                            : <Plus className="w-4 h-4" strokeWidth={2.5} />}
                        </button>
                      )}
                      <button
                        onClick={() => handleToggleActive(med)}
                        disabled={isLoading}
                        title={med.active ? 'Pause' : 'Resume'}
                        className={`w-9 h-9 rounded-full flex items-center justify-center bg-[#F2F2F7] text-foreground/70 hover:bg-[#E5E5EA] transition-all cursor-pointer disabled:opacity-50 ${isLoading ? 'animate-pulse' : ''}`}
                      >
                        {med.active ? <Pause className="w-4 h-4" strokeWidth={2.5} /> : <Play className="w-4 h-4" strokeWidth={2.5} />}
                      </button>
                      <Link
                        href={`/medications/${med.id}`}
                        title="Edit"
                        className="w-9 h-9 rounded-full flex items-center justify-center bg-[#F2F2F7] text-foreground/70 hover:bg-[#E5E5EA] transition-all"
                      >
                        <SquarePen className="w-4 h-4" strokeWidth={2.5} />
                      </Link>
                      <button
                        onClick={() => setDeleteModalMed(med)}
                        disabled={isLoading}
                        title="Delete"
                        className="w-9 h-9 rounded-full flex items-center justify-center bg-[#FFECEA] text-[#FF3B30] hover:bg-[#FFDAD6] transition-all cursor-pointer disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" strokeWidth={2.5} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add-stock modal */}
      {stockModalMed && (
        <div className="fixed inset-0 bg-foreground/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in" onClick={() => stockBusyId === null && setStockModalMed(null)}>
          <div className="bg-white rounded-[22px] max-w-sm w-full p-6 space-y-5" style={{ boxShadow: '0 8px 40px rgba(16, 28, 90, 0.18)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: cardTheme(stockModalMed).tint, color: cardTheme(stockModalMed).color }}>
                  {getUnitIcon(stockModalMed.unit_type, 'w-5 h-5')}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">Add stock</p>
                  <h3 className="text-base font-bold tracking-tight text-foreground truncate">{stockModalMed.drug_name}</h3>
                </div>
              </div>
              <button onClick={() => setStockModalMed(null)} disabled={stockBusyId !== null} className="w-8 h-8 rounded-full flex items-center justify-center bg-[#F2F2F7] hover:bg-[#E5E5EA] text-muted-foreground cursor-pointer transition-all disabled:opacity-50 shrink-0">
                <X className="w-4 h-4" strokeWidth={2.5} />
              </button>
            </div>

            <label className="block">
              <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                How many {stockModalMed.unit_type?.toLowerCase() || 'unit'}(s) did you add?
              </span>
              <input
                type="number"
                min="1"
                inputMode="numeric"
                autoFocus
                value={stockInput}
                onChange={(e) => { setStockInput(e.target.value); setStockError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') confirmAddStock(); }}
                placeholder="0"
                className="mt-1.5 w-full px-4 py-3 bg-[#F2F2F7] rounded-2xl text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              {stockModalMed.current_stock !== null && stockModalMed.current_stock !== undefined && (
                <span className="block mt-1.5 text-[11px] font-medium text-muted-foreground">
                  Current: {stockModalMed.current_stock}
                  {stockInput && Number(stockInput) > 0 ? ` → ${Number(stockModalMed.current_stock) + Number(stockInput)}` : ''}
                </span>
              )}
            </label>

            {stockError && <p className="text-[12px] font-semibold text-[#FF3B30]">{stockError}</p>}

            <div className="flex gap-2">
              <button
                onClick={() => setStockModalMed(null)}
                disabled={stockBusyId !== null}
                className="flex-1 py-3 bg-[#F2F2F7] text-muted-foreground hover:bg-[#E5E5EA] text-sm font-semibold rounded-full cursor-pointer transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmAddStock}
                disabled={stockBusyId !== null}
                className="flex-1 py-3 bg-primary text-white hover:bg-primary-hover text-sm font-semibold rounded-full cursor-pointer transition-all disabled:opacity-50"
                style={{ boxShadow: '0 4px 12px rgba(242, 107, 138, 0.35)' }}
              >
                {stockBusyId !== null ? 'Adding…' : 'Add stock'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteModalMed && (
        <div className="fixed inset-0 bg-foreground/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in" onClick={() => loadingId === null && setDeleteModalMed(null)}>
          <div className="bg-white rounded-[22px] max-w-sm w-full p-6 space-y-5 text-center" style={{ boxShadow: '0 8px 40px rgba(16, 28, 90, 0.18)' }} onClick={(e) => e.stopPropagation()}>
            <div className="w-14 h-14 rounded-full bg-[#FFECEA] flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6 text-[#FF3B30]" strokeWidth={2.2} />
            </div>
            <div>
              <h3 className="text-base font-bold tracking-tight text-foreground">Delete {deleteModalMed.drug_name}?</h3>
              <p className="text-[13px] font-medium text-muted-foreground mt-1">
                This permanently removes the medication and its reminders. This can&apos;t be undone.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteModalMed(null)}
                disabled={loadingId !== null}
                className="flex-1 py-3 bg-[#F2F2F7] text-muted-foreground hover:bg-[#E5E5EA] text-sm font-semibold rounded-full cursor-pointer transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={loadingId !== null}
                className="flex-1 py-3 bg-[#FF3B30] text-white hover:bg-[#E0352B] text-sm font-semibold rounded-full cursor-pointer transition-all disabled:opacity-50"
                style={{ boxShadow: '0 4px 12px rgba(255, 59, 48, 0.35)' }}
              >
                {loadingId !== null ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
