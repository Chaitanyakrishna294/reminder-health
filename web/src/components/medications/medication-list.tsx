'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { addStock } from '@/lib/medications/add-stock';
import { calculateNextReminder } from '@/lib/medication-utils';
import { useUiMode } from '@/context/ui-mode-context';
import { Plus, Package, Clock, Pause, Play, SquarePen, Trash2, Pill, X, ChevronDown, Search, Calendar, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import GuideButton from '@/components/guide/guide-button';
import GuideAutoStart from '@/components/guide/guide-auto-start';
import { getUnitIcon } from '@/lib/design/dose-forms';
import { priorityMeta } from '@/lib/design/semantics';
import { unitPhrase } from '@/components/medications/medication-form-options';
import { isLowStock as lowStockOf } from '@/lib/medications/stock';
import { EmptyState } from '@/components/ui/empty-state';
import MedicationCard from '@/components/medications/medication-card';
import { useDensity } from '@/context/density-context';
import { iconButtonClasses } from '@/components/ui/button';
import { searchMedicationCatalog, type CatalogSearchResult } from '@/lib/medications/catalog';
import { fetchDoseHistory, dosesForDate, weekOf, type DayDose, type DoseHistory } from '@/lib/schedule/day-doses';
import { toOverrideDateStr } from '@/lib/schedule/dose-engine';

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
  /** Weekdays the med is due, 0=Sun..6=Sat. Null = every day. */
  dose_days?: number[] | null;
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
  const [query, setQuery] = useState('');
  // Results from the real medicine directory (medication_catalog), so the same box that
  // finds a medication you already track can also find one you don't yet.
  const [catalogResults, setCatalogResults] = useState<CatalogSearchResult[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  // Day view. `null` means "show my medication list", which stays the page's default
  // job — picking a day switches the panel below to that day's doses.
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [weekAnchor, setWeekAnchor] = useState<Date>(new Date());
  const [dayHistory, setDayHistory] = useState<DoseHistory>({});

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
  //
  // current_stock ?? tablet_count: for a legacy medication current_stock is NULL and
  // tablet_count holds the real count. addStock treats a null/undefined base as 0,
  // so passing the raw field would silently drop the existing stock on refill
  // (e.g. 20 + 30 -> 30, not 50). The predicate, strip, gate and bot all use this
  // same fallback; this is the last write path that didn't.
  const confirmAddStock = async () => {
    if (!stockModalMed) return;
    const med = stockModalMed;
    const amount = Number(stockInput);
    setStockBusyId(med.id);
    setStockError('');
    try {
      const { newStock } = await addStock({
        supabase, medicationId: med.id, currentStock: med.current_stock ?? med.tablet_count, amount,
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
  // App density gets the same calm treatment as Today: the day-view week strip
  // duplicates the dashboard's own week strip, and two week strips in one app is
  // two places to learn the same gesture. Elderly drops it for the stronger
  // reason — see the readOnly note on MedicationCard.
  const { isApp } = useDensity();
  const showDayView = !isApp && !isElderly;
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
          .select('id, telegram_id, drug_name, dosage, frequency, reminder_times, tablet_count, priority_level, next_reminder_at, active, unit_type, dosage_amount, current_stock, stock_threshold, low_stock_alert_enabled, medication_reason, dose_days, catalog_id, linked_brand_name, linked_composition, linked_manufacturer, linked_snapshot_date, linked_is_discontinued')
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
        // (recomputing without it silently shifts non-IST medications to IST)
        // and on its OWN weekdays (without dose_days a paused Mon/Wed/Fri med
        // would resume onto whatever day it happened to be un-paused).
        const nextDate = calculateNextReminder(med.reminder_times, med.timezone ?? undefined, med.dose_days);
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

  // Debounced directory lookup. `supabase` is recreated on every render, so it is
  // deliberately NOT a dependency here — including it would restart this effect on each
  // render and fire a request per keystroke regardless of the debounce.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setCatalogResults([]);
      setCatalogLoading(false);
      return;
    }
    let cancelled = false;
    setCatalogLoading(true);
    const timer = setTimeout(async () => {
      const rows = await searchMedicationCatalog(supabase, term);
      if (cancelled) return;
      setCatalogResults(rows);
      setCatalogLoading(false);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const weekDays = React.useMemo(() => weekOf(weekAnchor), [weekAnchor]);

  // Fetched per WEEK, not per selected day. Gating it on selection was wrong: the
  // strip prints a dose count on every day, and without history a past day shows its
  // projection — "2 doses" on a day that actually recorded one. The count has to be
  // the real one before it is shown, not after you tap it.
  useEffect(() => {
    if (!targetTelegramChatId || weekDays.length === 0) return;
    const from = new Date(weekDays[0]); from.setHours(0, 0, 0, 0);
    const to = new Date(weekDays[weekDays.length - 1]); to.setHours(23, 59, 59, 999);
    let cancelled = false;
    (async () => {
      const grouped = await fetchDoseHistory(supabase, targetTelegramChatId, from, to);
      if (!cancelled) setDayHistory(grouped);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetTelegramChatId, weekDays]);

  const dosesForSelectedDay: DayDose[] = selectedDay
    ? dosesForDate(selectedDay, { medications: meds.filter(m => m.active), history: dayHistory })
    : [];

  // The inventory question — "do I need to order anything?" — asked once for the
  // whole list. The per-card chips answer it medication by medication, which is
  // the wrong shape for a question about the cupboard as a whole, and on a list
  // of twelve it means scrolling all twelve to find out.
  const lowStockMeds = meds.filter((m) => m.active && lowStockOf(m).low);

  const activeMeds = meds.filter(m => m.active);
  const pausedMeds = meds.filter(m => !m.active);
  // With nothing paused there are no tabs, so the filter must not hide anything.
  // Elderly has no tabs, so it must not inherit a filter — and it shows ACTIVE
  // medications only. A paused medication is one you are not taking, which is
  // precisely the wrong thing to list on a screen answering "what am I taking?".
  const tabMeds = isElderly
    ? activeMeds
    : pausedMeds.length === 0
      ? meds
      : filter === 'paused' ? pausedMeds : activeMeds;

  // Search across the fields someone would actually recall a medication by: what it is
  // called, the dose, and why they take it — a reason like "blood pressure" is often the
  // only thing remembered when the brand name isn't.
  const q = query.trim().toLowerCase();
  const visibleMeds = q
    ? tabMeds.filter(m =>
        [m.drug_name, m.dosage, m.medication_reason]
          .some(v => (v || '').toLowerCase().includes(q))
      )
    : tabMeds;

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
      {/* Auto-start the guided tour once, for a genuinely new account only (always
          summonable via the ? button). `initialMeds`, not the filtered `meds` — a
          long-standing user who has paused everything is still a long-standing user. */}
      <GuideAutoStart tour="medications" accountHasData={initialMeds.length > 0} />
      {/* Header */}
      <div data-tour="med-hero" className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
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
        {/* ELDERLY SEES NO CONTROLS HERE. Adding a medication and planning a
            schedule are both regimen decisions — the same class of work as
            correcting a past dose, which elderly already excludes on the grounds
            that judging a regimen is the caregiver's job from their own phone.
            The mode is switchable from Settings when that judgement is needed. */}
        {!isElderly && (
        <div className="flex items-center gap-2 shrink-0">
          {/* Scheduler's primary entry point now that it is out of the bottom nav. A
              plain labelled link on purpose: the week strip on the planner SELECTS a day,
              and reusing that control here to navigate instead would give one control two
              meanings depending on the page it appears on. */}
          <Link
            href="/schedule-planner"
            aria-label="Open the schedule planner"
            className={`inline-flex items-center justify-center gap-1.5 font-semibold rounded-full bg-muted text-foreground hover:bg-accent-surface transition-all ${
              isElderly ? 'h-14 px-5 text-base' : 'h-11 px-4 text-[13px]'
            }`}
          >
            <Calendar className="w-4 h-4 shrink-0" strokeWidth={2.5} />
            Schedule
          </Link>
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
        )}
      </div>

      {/* MANAGE INVENTORY'S ENTRY. It used to be a solid-pink button on Today,
          the loudest control on a screen about taking a dose — restocking is a
          weekly errand, not a today action. Here it is the page's own business,
          and it only appears when there is something to say. Elderly never sees
          it: ordering medicine is caregiver work.

          Warning tone, not danger: running low is a waiting state with time to
          act, and the word "low" carries the meaning so colour is never alone. */}
      {!selectedDay && !isElderly && lowStockMeds.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-warning/35 bg-warning/10 px-4 py-3">
          <Package className="w-4 h-4 shrink-0 mt-0.5 text-warning-strong" aria-hidden />
          <div className="min-w-0">
            <p className={`font-bold text-warning-strong ${isElderly ? 'text-base' : 'text-[13px]'}`}>
              {lowStockMeds.length === 1
                ? '1 medicine is running low'
                : `${lowStockMeds.length} medicines are running low`}
            </p>
            <p className={`text-warning-strong/90 font-semibold text-balance ${isElderly ? 'text-sm' : 'text-[11px]'}`}>
              {lowStockMeds.map((m) => m.drug_name).join(', ')}
              {isOwnMeds ? ' — tap Add stock on a card below to top it up.' : ''}
            </p>
          </div>
        </div>
      )}

      {/* One box, two jobs: filter what you already take, and look the rest up in the
          real medicine directory. Always shown, because searching the directory is
          useful even with an empty list. */}
      {!selectedDay && activeRole !== 'CAREGIVER' && !isElderly && (
        /* STICKY. The list is the only thing that scrolls under it, and hunting
           back up the page to change one letter of a query is the whole reason a
           search box gets abandoned. `-mx-1 px-1` so the sticky element's own
           background covers the cards' shadow as they pass beneath it. */
        <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-background/95 backdrop-blur space-y-3">
          <div className="relative">
            <Search className={`absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none shrink-0 ${isElderly ? 'w-5 h-5' : 'w-4 h-4'}`} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              /* Was "Search your list or the medicine directory", which ran past the
                 right edge of a 326px field and got clipped mid-word. The full sentence
                 stays as the accessible name below. */
              placeholder="Search medicines"
              aria-label="Search your medications or the medicine directory"
              className={`w-full rounded-2xl bg-card border border-border pl-10 pr-12 font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors ${
                isElderly ? 'h-14 text-base' : 'h-11 text-[13px]'
              }`}
            />
            {/* `type="search"` renders a native clear affordance on some engines
                and nothing at all on Android's WebView — which is the one that
                matters here. An explicit 44px button is the only version that
                exists everywhere. */}
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => { setQuery(''); setCatalogResults([]); }}
                aria-label="Clear the search"
                className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="w-4 h-4" strokeWidth={2.5} aria-hidden />
              </button>
            )}
          </div>

          {q.length >= 2 && (
            <div className="rounded-2xl border border-border bg-card p-3 space-y-2">
              <p className={`font-black text-muted-foreground ${isElderly ? 'text-sm' : 'text-[11px]'}`}>
                From the medicine directory
              </p>

              {catalogLoading ? (
                <div className="space-y-2" aria-live="polite">
                  {[0, 1].map(i => <div key={i} className="h-12 rounded-xl bg-muted animate-pulse" />)}
                  <span className="sr-only">Searching the medicine directory…</span>
                </div>
              ) : catalogResults.length === 0 ? (
                <p className={`text-muted-foreground font-semibold ${isElderly ? 'text-sm' : 'text-[11px]'}`}>
                  Nothing in the directory matches that. You can still add it by name.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {catalogResults.slice(0, 6).map((row) => (
                    <li key={row.id}>
                      {/* Carries the chosen row's id AND name. The wizard re-reads that row
                          from the database before linking it, so a hand-edited URL cannot
                          invent a link — and the link is still only ever created by this
                          explicit human choice, never by matching a nickname. */}
                      <Link
                        href={`/medications/new?catalogId=${row.id}&name=${encodeURIComponent(row.brand_name)}`}
                        className="flex items-center gap-2 min-h-11 px-3 py-2 rounded-xl hover:bg-muted transition-colors cursor-pointer"
                      >
                        <Plus className="w-4 h-4 shrink-0 text-primary-strong" strokeWidth={2.5} />
                        <span className="min-w-0">
                          <span className={`block font-bold text-foreground truncate ${isElderly ? 'text-base' : 'text-[13px]'}`}>
                            {row.brand_name}
                            {row.is_discontinued && (
                              <span className="ml-1.5 font-semibold text-warning-strong">· discontinued</span>
                            )}
                          </span>
                          {/* Pack size is included because the directory holds several rows
                              per brand — without it "Dolo 500 Tablet" appeared twice,
                              identical, with no way to tell which one you were picking. */}
                          {(row.composition_text || row.manufacturer_name || row.pack_size_label) && (
                            <span className={`block text-muted-foreground truncate ${isElderly ? 'text-sm' : 'text-[11px]'}`}>
                              {[row.composition_text, row.manufacturer_name, row.pack_size_label].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* PHONE NEVER SHOWS THE DAY VIEW, browser or app.
          The approved rule was "app drops the duplicate week strip", and the
          reason — Today already has a week strip, and two of them is two places
          to learn one gesture — is about the SCREEN, not the wrapper. On a 375px
          phone this strip is ~180px of a first screen that otherwise had to fit a
          title, three buttons, a stock notice, a search field and a tab pair
          before a single medication appeared. It did not: the first card started
          below the fold on a page whose entire job is the list.
          Desktop keeps it, where it costs nothing. The full planner is one tap
          away from the Schedule button on every size. */}
      {showDayView && (<><div className="hidden sm:contents">
      {/* Week strip. It SELECTS a day — the same thing this control does on the
          planner — rather than navigating somewhere. A day-picker that teleports would
          mean one control with two meanings depending on the page it sits on.
          Tapping the selected day again returns to the medication list.

          Client-only, deliberately. Every label here is locale- and timezone-derived
          (`toLocaleDateString`, and "today" itself), so server-rendering it produced
          "Aug 2" on the server against "2 Aug" in the browser and React threw a
          hydration mismatch. A reserved-height placeholder keeps the page from
          jumping when the real strip arrives. */}
      {!mounted ? (
        <div className="card-lift p-2 sm:p-4 h-[136px] sm:h-[150px]" aria-hidden />
      ) : (
      <div className="card-lift p-2 sm:p-4">
        <div className="flex items-center justify-between mb-3 gap-2">
          <button
            onClick={() => setWeekAnchor(d => { const n = new Date(d); n.setDate(d.getDate() - 7); return n; })}
            aria-label="Previous week"
            className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center bg-muted hover:bg-accent-surface text-foreground transition-all cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" strokeWidth={2.5} />
          </button>
          <h2 className={`font-bold tracking-tight text-foreground text-center min-w-0 truncate ${isElderly ? 'text-base' : 'text-sm'}`}>
            {weekDays[0].toLocaleDateString([], { month: 'short', day: 'numeric' })} – {weekDays[6].toLocaleDateString([], { month: 'short', day: 'numeric' })}
          </h2>
          <button
            onClick={() => setWeekAnchor(d => { const n = new Date(d); n.setDate(d.getDate() + 7); return n; })}
            aria-label="Next week"
            className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center bg-muted hover:bg-accent-surface text-foreground transition-all cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" strokeWidth={2.5} />
          </button>
        </div>

        {/* gap-0.5 below sm is not cosmetic: seven buttons across a 375px screen only
            clear the 44px touch floor once the padding and gaps give the width back. */}
        <div className="flex gap-0.5 sm:gap-1.5 items-stretch">
          {weekDays.map((d) => {
            const dayStr = toOverrideDateStr(d);
            const isSelected = selectedDay != null && toOverrideDateStr(selectedDay) === dayStr;
            const isToday = dayStr === toOverrideDateStr(new Date());
            const count = dosesForDate(d, { medications: meds.filter(m => m.active), history: dayHistory }).length;
            return (
              <button
                key={dayStr}
                onClick={() => setSelectedDay(isSelected ? null : d)}
                aria-pressed={isSelected}
                aria-label={`${d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}, ${count} ${count === 1 ? 'dose' : 'doses'}`}
                /* Matches the Schedule Planner's strip: -9deg skew, a 7px radius rather
                   than a soft pill, and the selected tab growing and lifting out of the
                   row. Tokens instead of the planner's hardcoded hexes so it survives
                   dark mode. */
                className={
                  /* No min-width, matching the planner. Seven 44px tiles need more
                     than a 375px row has, so a floor here left flex-grow no slack and
                     every tile stayed the same size — the selected tab could not
                     expand. Unselected tiles now shrink below 44px on a narrow screen;
                     the selected one is always well over it. */
                  'group relative cursor-pointer rounded-[7px] ' +
                  (isSelected
                    ? 'bg-gradient-to-b from-[#CC3D64] to-[#B52A52] text-white z-10'
                    : isToday
                      ? 'bg-primary-soft text-foreground'
                      : 'bg-muted text-foreground hover:bg-accent-surface')
                }
                style={{
                  flexGrow: isSelected ? 2.1 : 1,
                  flexBasis: 0,
                  // A flex item defaults to min-width:auto, which refuses to shrink
                  // below its own text. With seven nowrap tiles that consumed the whole
                  // row, so flex-grow had nothing left to distribute and every tile
                  // rendered identically. This is the line that lets the tab expand.
                  minWidth: 0,
                  transform: `skewX(-9deg)${isSelected ? ' translateY(-5px)' : ''}`,
                  boxShadow: isSelected ? '0 14px 26px rgba(242, 107, 138, 0.45)' : '0 0 0 rgba(242, 107, 138, 0)',
                  willChange: 'flex-grow, transform',
                  transitionProperty: 'flex-grow, transform, background-color, box-shadow',
                  transitionDuration: '650ms',
                  transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                <span
                  className={'flex flex-col items-center justify-center ' + (isSelected ? 'gap-1 py-3.5' : 'gap-1.5 py-3')}
                  style={{
                    transform: 'skewX(9deg)',
                    transitionProperty: 'gap, padding',
                    transitionDuration: '650ms',
                    transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  <span
                    className={
                      'uppercase font-bold tracking-wide whitespace-nowrap ' +
                      (isSelected ? 'text-[11px] text-white/80' : 'text-[11px] text-muted-foreground')
                    }
                  >
                    {d.toLocaleDateString([], { weekday: 'short' })}
                  </span>
                  <span
                    className={
                      'font-extrabold leading-none tabular-nums transition-[font-size] duration-[650ms] ease-[cubic-bezier(0.16,1,0.3,1)] ' +
                      (isSelected ? 'text-2xl' : 'text-base')
                    }
                  >
                    {d.getDate()}
                  </span>
                  {isSelected && (
                    <span className="mt-0.5 text-[11px] font-bold leading-none text-white/85 whitespace-nowrap animate-fade-in">
                      {count > 0 ? `${count} dose${count > 1 ? 's' : ''}` : 'clear'}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      )}
      </div></>)}

      {/* Active / Paused tabs — only meaningful once something is paused. */}
      {!selectedDay && !isElderly && pausedMeds.length > 0 && (
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

      {/* Day view. Replaces the list while a day is selected, so the page has one job
          at a time rather than two stacked answers to "what am I looking at". */}
      {selectedDay && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className={`font-bold tracking-tight text-foreground ${isElderly ? 'text-lg' : 'text-sm'}`}>
              {selectedDay.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
            </h3>
            <button
              onClick={() => setSelectedDay(null)}
              className={`shrink-0 inline-flex items-center justify-center min-h-11 px-4 rounded-full bg-muted text-foreground hover:bg-accent-surface font-semibold transition-all cursor-pointer ${isElderly ? 'text-base' : 'text-[13px]'}`}
            >
              Back to all medications
            </button>
          </div>

          {dosesForSelectedDay.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card/60 p-8 text-center">
              <p className={`font-bold text-foreground ${isElderly ? 'text-base' : 'text-sm'}`}>A clear day</p>
              <p className={`font-medium text-muted-foreground mt-1 ${isElderly ? 'text-sm' : 'text-xs'}`}>
                No doses on this day.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {dosesForSelectedDay.map((dose, i) => (
                <li
                  key={`${dose.id}-${dose.time}-${i}`}
                  className="flex items-center gap-3 card-lift p-3"
                >
                  <span
                    aria-hidden
                    className="shrink-0 w-2.5 h-2.5 rounded-full"
                    style={{ background: `var(--${priorityMeta(dose.priority_level).tone})` }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block font-bold text-foreground truncate ${isElderly ? 'text-base' : 'text-[13px]'}`}>
                      {dose.drug_name}
                    </span>
                    <span className={`block font-semibold text-muted-foreground truncate ${isElderly ? 'text-sm' : 'text-[11px]'}`}>
                      {dose.time}
                      {dose.dosage && dose.dosage !== 'N/A' ? ` · ${dose.dosage}` : ''}
                      {/* Named plainly: this dose survives only through the log's snapshot. */}
                      {dose.isDeleted ? ' · deleted medication' : ''}
                    </span>
                  </span>
                  {dose.outcome && (
                    <span
                      className={
                        'shrink-0 text-[11px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ' +
                        (dose.outcome === 'TAKEN'
                          ? 'bg-success/15 text-success-strong'
                          : dose.outcome === 'SKIP'
                            ? 'bg-warning/15 text-warning-strong'
                            : 'bg-danger/15 text-danger-strong')
                      }
                    >
                      {dose.outcome === 'TAKEN' ? 'Taken' : dose.outcome === 'SKIP' ? 'Skipped' : 'Missed'}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Cards */}
      {selectedDay ? null : visibleMeds.length === 0 ? (
        <EmptyState
          icon={<Pill className={isElderly ? 'w-9 h-9' : 'w-6 h-6'} />}
          title={
            q
              ? 'No medicines match'
              : meds.length === 0
                ? 'No medications yet'
                : filter === 'paused'
                  ? 'Nothing paused'
                  : 'No active medications'
          }
          description={
            q
              ? 'Check the spelling, or add it as new.'
              : meds.length === 0
                ? 'Add your first medication and we will remind you when each dose is due.'
                : filter === 'paused'
                  ? 'Medications you pause will wait here until you resume them.'
                  : 'All of your medications are paused right now.'
          }
          action={
            activeRole === 'CAREGIVER'
              ? undefined
              : q
                ? {
                    /* Carries the query into the wizard, where the catalog picker can
                       look it up. Still human-select-only — this prefills the name
                       field, it never matches a nickname to a real drug. */
                    label: `Add “${query.trim()}”`,
                    href: `/medications/new?name=${encodeURIComponent(query.trim())}`,
                  }
                : meds.length === 0
                  ? { label: 'Add medication', href: '/medications/new' }
                  : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {visibleMeds.map((med, idx) => (
            <MedicationCard
              key={med.id}
              med={med}
              index={idx}
              isElderly={isElderly}
              isLowStock={lowStockOf(med).low}
              /* Elderly answers "what am I taking?" and stops there; the
                 caregiver-monitor view is read-only by definition. */
              readOnly={isElderly || activeRole === 'CAREGIVER'}
              canEditStock={isOwnMeds}
              isBusy={loadingId === med.id}
              isStockBusy={stockBusyId === med.id}
              expanded={expandedIds.has(med.id)}
              onToggleExpanded={() => toggleExpanded(med.id)}
              onAddStock={() => openStockModal(med)}
              onTogglePause={() => handleToggleActive(med)}
              onDelete={() => setDeleteModalMed(med)}
            />
          ))}
        </div>
      )}

      {/* Add-stock modal */}
      {stockModalMed && (
        <div className="fixed inset-0 bg-foreground/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in" onClick={() => stockBusyId === null && setStockModalMed(null)}>
          <div className="card-lift max-w-sm w-full p-6 space-y-5" style={{ boxShadow: '0 8px 40px rgba(16, 28, 90, 0.18)' }} onClick={(e) => e.stopPropagation()}>
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
              <button onClick={() => setStockModalMed(null)} disabled={stockBusyId !== null} className="w-8 h-8 rounded-full flex items-center justify-center bg-muted hover:bg-input text-muted-foreground cursor-pointer transition-all disabled:opacity-50 shrink-0">
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
                className="mt-1.5 w-full px-4 py-3 bg-muted rounded-2xl text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              {(stockModalMed.current_stock ?? stockModalMed.tablet_count ?? null) !== null && (
                <span className="block mt-1.5 text-[11px] font-medium text-muted-foreground">
                  Current: {stockModalMed.current_stock ?? stockModalMed.tablet_count}
                  {stockInput && Number(stockInput) > 0 ? ` → ${Number(stockModalMed.current_stock ?? stockModalMed.tablet_count) + Number(stockInput)}` : ''}
                </span>
              )}
            </label>

            {stockError && <p className="text-[12px] font-semibold text-danger-strong">{stockError}</p>}

            <div className="flex gap-2">
              <button
                onClick={() => setStockModalMed(null)}
                disabled={stockBusyId !== null}
                className="flex-1 py-3 bg-muted text-muted-foreground hover:bg-input text-sm font-semibold rounded-full cursor-pointer transition-all disabled:opacity-50"
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
          <div className="card-lift max-w-sm w-full p-6 space-y-5 text-center" style={{ boxShadow: '0 8px 40px rgba(16, 28, 90, 0.18)' }} onClick={(e) => e.stopPropagation()}>
            <div className="w-14 h-14 rounded-full bg-danger/10 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6 text-danger-strong" strokeWidth={2.2} />
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
                className="flex-1 py-3 bg-muted text-muted-foreground hover:bg-input text-sm font-semibold rounded-full cursor-pointer transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={loadingId !== null}
                className="flex-1 py-3 bg-danger-solid text-danger-solid-foreground hover:brightness-95 text-sm font-semibold rounded-full cursor-pointer transition-all disabled:opacity-50"
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
