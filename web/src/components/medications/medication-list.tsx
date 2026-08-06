'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { addStock } from '@/lib/medications/add-stock';
import { calculateNextReminder } from '@/lib/medication-utils';
import { useUiMode } from '@/context/ui-mode-context';
import { Plus, Package, Clock, Pause, Play, SquarePen, Trash2, Pill, X, ChevronDown } from 'lucide-react';
import GuideButton from '@/components/guide/guide-button';
import GuideAutoStart from '@/components/guide/guide-auto-start';
import { getUnitIcon } from '@/components/ui/custom-icons';
import { priorityMeta } from '@/lib/design/semantics';
import { unitPhrase } from '@/components/medications/medication-form-options';
import { isLowStock as lowStockOf } from '@/lib/medications/stock';
import { EmptyState } from '@/components/ui/empty-state';
import { iconButtonClasses } from '@/components/ui/button';

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
  low_stock_alert_enabled?: boolean | null;
  medication_reason?: string | null;
  timezone?: string | null;
  catalog_id?: number | null;
  linked_brand_name?: string | null;
  linked_composition?: string | null;
  linked_manufacturer?: string | null;
  linked_snapshot_date?: string | null;
  linked_is_discontinued?: boolean | null;
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
  // "1 active" was a caption next to a single visible card — it restated what you could
  // already see. As a tab pair it earns its place: it says a paused list exists and
  // gets you there. Only shown once something is actually paused.
  const [filter, setFilter] = useState<'active' | 'paused'>('active');
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [stockBusyId, setStockBusyId] = useState<number | null>(null);

  // Tracks which medications' linked-composition line is expanded. A Set (not a single
  // id) so multiple cards can be open independently, not accordion-exclusive.
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const toggleExpanded = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

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
    setStockBusyId(med.id);
    setStockError('');
    try {
      const { newStock } = await addStock({
        supabase, medicationId: med.id, currentStock: med.current_stock, amount,
      });
      setMeds(prev => prev.map(m => (m.id === med.id ? { ...m, current_stock: newStock } : m)));
      setStockModalMed(null);
      setStockInput('');
    } catch (err) {
      setStockError(err instanceof Error ? err.message : 'Could not update stock.');
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
          .select('id, telegram_id, drug_name, dosage, frequency, reminder_times, tablet_count, priority_level, next_reminder_at, active, unit_type, dosage_amount, current_stock, stock_threshold, low_stock_alert_enabled, medication_reason, catalog_id, linked_brand_name, linked_composition, linked_manufacturer, linked_snapshot_date, linked_is_discontinued')
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
  // With nothing paused there are no tabs, so the filter must not hide anything.
  const visibleMeds = pausedMeds.length === 0
    ? meds
    : filter === 'paused' ? pausedMeds : activeMeds;

  // Accent per card, driven by priority. This used to be a local hex map that made
  // routine medications PINK here while the wizard's own picker showed them green —
  // the same medication changed color between the screen you set it on and the screen
  // you read it on. Tokens now, one source (lib/design/semantics).
  const cardTheme = (med: Medication) => {
    if (!med.active) return { color: 'var(--muted-foreground)', tint: 'var(--muted)' };
    const tone = priorityMeta(med.priority_level).tone;
    return {
      color: `var(--${tone}-strong)`,
      tint: `color-mix(in srgb, var(--${tone}) 12%, transparent)`,
    };
  };

  const cardShadow = '0 1px 3px rgba(16, 28, 90, 0.04), 0 10px 30px rgba(16, 28, 90, 0.06)';

  return (
    <div className="space-y-5">
      {/* Auto-start the guided tour once for first-time users (then summonable via the ? button). */}
      <GuideAutoStart tour="medications" />
      {/* Header */}
      <div data-tour="med-hero" className="flex items-end justify-between gap-3">
        <div>
          <h1 className={`font-bold tracking-tight text-foreground ${isElderly ? 'text-[28px]' : 'text-[26px]'}`}>
            {patientName ? `${patientName}'s Medications` : 'Medications'}
          </h1>
          {pausedMeds.length === 0 && (
            <p className={`text-muted-foreground mt-0.5 font-medium ${isElderly ? 'text-base' : 'text-[13px]'}`}>
              {activeMeds.length} {activeMeds.length === 1 ? 'medication' : 'medications'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <GuideButton tour="medications" />
          {activeRole !== 'CAREGIVER' && (
            <Link
              href="/medications/new"
              aria-label="Add medication"
              className={`inline-flex items-center justify-center gap-1.5 font-semibold rounded-full bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover transition-all ${
                isElderly ? 'h-14 px-6 text-base' : 'h-11 px-4 text-[13px]'
              }`}
              style={{ boxShadow: '0 4px 12px rgba(242, 107, 138, 0.35)' }}
            >
              <Plus className="w-4 h-4 shrink-0" strokeWidth={2.5} />
              Add
            </Link>
          )}
        </div>
      </div>

      {/* Active / Paused tabs — only meaningful once something is paused. */}
      {pausedMeds.length > 0 && (
        <div role="tablist" aria-label="Filter medications" className="flex items-center gap-2">
          {([
            ['active', 'Active', activeMeds.length],
            ['paused', 'Paused', pausedMeds.length],
          ] as const).map(([id, label, count]) => (
            <button
              key={id}
              role="tab"
              aria-selected={filter === id}
              onClick={() => setFilter(id)}
              className={`h-11 px-4 rounded-full font-bold transition-all cursor-pointer ${
                isElderly ? 'text-base' : 'text-[13px]'
              } ${
                filter === id
                  ? 'bg-primary-strong text-primary-strong-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {label} ({count})
            </button>
          ))}
        </div>
      )}

      {/* Cards */}
      {visibleMeds.length === 0 ? (
        <EmptyState
          icon={<Pill className={isElderly ? 'w-9 h-9' : 'w-6 h-6'} />}
          title={
            meds.length === 0
              ? 'No medications yet'
              : filter === 'paused'
                ? 'Nothing paused'
                : 'No active medications'
          }
          description={
            meds.length === 0
              ? 'Add your first medication and we will remind you when each dose is due.'
              : filter === 'paused'
                ? 'Medications you pause will wait here until you resume them.'
                : 'All of your medications are paused right now.'
          }
          action={
            activeRole !== 'CAREGIVER' && meds.length === 0
              ? { label: 'Add medication', href: '/medications/new' }
              : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {visibleMeds.map((med, idx) => {
            const isLoading = loadingId === med.id;
            const isLowStock = lowStockOf(med).low;
            const t = cardTheme(med);
            const stockColor = isLowStock ? 'var(--danger-strong)' : t.color;

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
                      {/* Amount-per-dose and strength used to run together as
                          "5 ml(s) · 10mg", which reads as two competing numbers. Label
                          which is which. */}
                      <p className={`text-muted-foreground font-medium mt-0.5 ${isElderly ? 'text-base' : 'text-[13px]'}`}>
                        {med.dosage && med.dosage !== 'N/A' ? (
                          <>Dose: {med.dosage} in {med.dosage_amount || 1} {unitPhrase(med.unit_type, med.dosage_amount || 1)}</>
                        ) : (
                          <>Dose: {med.dosage_amount || 1} {unitPhrase(med.unit_type, med.dosage_amount || 1)}</>
                        )}
                      </p>
                      {med.linked_brand_name && (
                        <div className="mt-1">
                          <button
                            type="button"
                            onClick={() => toggleExpanded(med.id)}
                            className="flex items-center gap-1 text-left w-full cursor-pointer"
                            aria-expanded={expandedIds.has(med.id)}
                            aria-label="Toggle medication details"
                          >
                            <span
                              className={`text-[11px] text-muted-foreground/80 font-medium flex-1 min-w-0 ${
                                expandedIds.has(med.id) ? '' : 'truncate'
                              }`}
                            >
                              {med.linked_brand_name}{med.linked_composition ? ` — ${med.linked_composition}` : ''}
                              {med.linked_is_discontinued && (
                                <span className="ml-1.5 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground align-middle">
                                  Discontinued
                                </span>
                              )}
                            </span>
                            <ChevronDown
                              className={`w-3.5 h-3.5 text-muted-foreground/60 shrink-0 transition-transform ${
                                expandedIds.has(med.id) ? 'rotate-180' : ''
                              }`}
                              aria-hidden="true"
                            />
                          </button>
                          {expandedIds.has(med.id) && med.linked_manufacturer && (
                            <p className="text-[9px] text-muted-foreground/70 mt-0.5">
                              Manufacturer: {med.linked_manufacturer}
                            </p>
                          )}
                          <span className="block text-[9px] text-muted-foreground/70 mt-0.5">
                            Patient-selected from catalog · as of {med.linked_snapshot_date}
                          </span>
                        </div>
                      )}
                      {/* Category + frequency pills */}
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <span
                          className="inline-flex items-center gap-1 font-semibold rounded-full px-2.5 py-1 text-[11px]"
                          style={{ background: t.tint, color: t.color }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.color }} />
                          {priorityMeta(med.priority_level).label}
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
                    {/* Capped: an uncapped "inhalations left" label grew this column to
                        99px and pushed "Dose: 5mg in 2.5 inhalations" onto two lines.
                        The word "left" is dropped too — a bare count beside a unit
                        already reads as remaining, and the Low stock line below says
                        the state outright. */}
                    <div data-tour={idx === 0 ? 'med-stock' : undefined} className="shrink-0 text-right max-w-[76px]">
                      {med.current_stock !== null && med.current_stock !== undefined ? (
                        <>
                          <p
                            className={`font-bold tabular-nums leading-none ${isElderly ? 'text-4xl' : 'text-[32px]'}`}
                            style={{ color: stockColor }}
                          >
                            {med.current_stock}
                          </p>
                          {/* A bare "4" told you nothing — 4 tablets or 4 ml? And the
                              label flipped between "Low" and "left" for the same slot.
                              Always the unit; "Low" is an extra word, not a swap, so the
                              warning never costs you the reading. */}
                          {/* No `tracking-wide` here: the extra letter-spacing pushed
                              the longest unit ("inhalations") 2px past the column and
                              clipped its last letter. */}
                          <p className="font-semibold text-[11px] uppercase mt-1 leading-tight text-muted-foreground">
                            {unitPhrase(med.unit_type, Number(med.current_stock))}
                          </p>
                          {isLowStock && (
                            <p className="font-black text-[11px] uppercase tracking-wide mt-0.5 leading-tight text-danger-strong">
                              Low stock
                            </p>
                          )}
                        </>
                      ) : (
                        <Package className="w-5 h-5 text-muted-foreground/40 mt-1" aria-label="Stock not tracked" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Divider */}
                <div className="h-px bg-[#0F1C5A]/[0.06] mx-5" />

                {/* Footer region.
                    Times and the four action buttons used to share one row. Once the
                    buttons went to 44px for touch, four of them plus the divider ate
                    ~210px of a 375px screen and squeezed the time pills to 58px — so
                    "7:40 PM" wrapped onto two lines inside its own pill. They get their
                    own rows below sm; side by side from sm up where there is room. */}
                <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  {/* Times */}
                  <div data-tour={idx === 0 ? 'med-times' : undefined} className="flex items-center gap-1.5 flex-wrap min-w-0">
                    {med.reminder_times.map((time, ti) => (
                      <span
                        key={ti}
                        className={`inline-flex items-center gap-1 font-semibold rounded-full whitespace-nowrap ${
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
                    /* Four identical 36px circles in a row, distinguishable only by a
                       small glyph, put "delete this medication" one slip away from
                       "log a dose". Now: 44px targets, real accessible names (a `title`
                       is not announced on touch), and the destructive one pushed out of
                       the group by a divider. */
                    <div data-tour={idx === 0 ? 'med-actions' : undefined} className="flex items-center gap-2 shrink-0">
                      {isOwnMeds && (
                        <button
                          onClick={() => openStockModal(med)}
                          disabled={stockBusyId === med.id}
                          title="Add stock"
                          aria-label={`Add stock for ${med.drug_name}`}
                          className={iconButtonClasses({ isElderly })}
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
                        aria-label={`${med.active ? 'Pause' : 'Resume'} reminders for ${med.drug_name}`}
                        className={iconButtonClasses({ isElderly, className: isLoading ? 'animate-pulse' : '' })}
                      >
                        {med.active ? <Pause className="w-4 h-4" strokeWidth={2.5} /> : <Play className="w-4 h-4" strokeWidth={2.5} />}
                      </button>
                      <Link
                        href={`/medications/${med.id}`}
                        title="Edit"
                        aria-label={`Edit ${med.drug_name}`}
                        className={iconButtonClasses({ isElderly })}
                      >
                        <SquarePen className="w-4 h-4" strokeWidth={2.5} />
                      </Link>

                      <span className="w-px self-stretch bg-border mx-1" aria-hidden="true" />

                      <button
                        onClick={() => setDeleteModalMed(med)}
                        disabled={isLoading}
                        title="Delete"
                        aria-label={`Delete ${med.drug_name}`}
                        className={iconButtonClasses({ variant: 'danger-ghost', isElderly })}
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
                How many {unitPhrase(stockModalMed.unit_type, 2)} did you add?
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
                className="flex-1 py-3 bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover text-sm font-semibold rounded-full cursor-pointer transition-all disabled:opacity-50"
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
