'use client';

/**
 * One medication, as a card.
 *
 * WHAT THIS SCREEN IS FOR: someone standing at a cupboard asking "which one is
 * this, and when do I take it?" — not managing a database. So the NAME is the
 * focal element and wins on size, weight and position; everything else is
 * demoted to answer a follow-up question.
 *
 * The hierarchy is three levers, not one: name 20px/black/foreground · strength
 * and schedule 13px/medium/muted · chips 11px/semibold/tinted. Squint and you
 * see a name, a grey line, and a row of small marks — which is the right order.
 *
 * LESSONS CARRIED OVER FROM THE PREVIOUS CARD, each one paid for:
 *  - Stock is NOT a display-size figure. At 32px in its own column it was the
 *    loudest thing on a card about medication, inverting what the page is for,
 *    and its width squeezed the chips onto two rows.
 *  - A bare "4" is ambiguous — 4 tablets or 4 ml? The unit always ships with the
 *    number.
 *  - Chips get a full-width row of their own. Nested beside an icon tile and a
 *    stock column they had ~151px and wrapped on every single card.
 *  - Actions are 44px with real accessible names (`title` is not announced on
 *    touch), and the destructive one sits past a divider — four identical
 *    circles put "delete this medication" one slip from "add stock".
 *
 * WHAT CHANGED: the time pills and the `once_daily` frequency chip both went.
 * They said the same thing twice in two vocabularies and neither mentioned which
 * DAYS, so a Monday/Thursday medication read as "Twice Daily" and surprised
 * someone on a Tuesday. One `scheduleSummary` line replaces both. Stock moved
 * from a column to a chip, which is what freed the width.
 */

import React from 'react';
import Link from 'next/link';
import { Plus, Pause, Play, SquarePen, Trash2, ChevronDown, Package } from 'lucide-react';
import { doseFormOf } from '@/lib/design/dose-forms';
import { priorityMeta } from '@/lib/design/semantics';
import { unitPhrase, scheduleSummary } from '@/components/medications/medication-form-options';
import { iconButtonClasses } from '@/components/ui/button';
import type { Medication } from '@/components/medications/medication-list';

export interface MedicationCardProps {
  med: Medication;
  isElderly: boolean;
  /** True when this medication's stock is at or under its threshold. */
  isLowStock: boolean;
  /**
   * Elderly, and the caregiver-monitor view. Renders the card as a statement
   * rather than a control panel: no pause, no edit, no delete, no stock button.
   * Elderly's question is "what am I taking?" — repairing a regimen needs
   * judgement about a regimen, which is the caregiver's job from their own
   * phone, the same reasoning that keeps dose corrections out of elderly.
   */
  readOnly: boolean;
  /** Stock is only editable on your OWN medications, never a monitored patient's. */
  canEditStock: boolean;
  isBusy: boolean;
  isStockBusy: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onAddStock: () => void;
  onTogglePause: () => void;
  onDelete: () => void;
  /** Index in the list — drives the entrance cascade and the tour anchors. */
  index: number;
}

export default function MedicationCard({
  med,
  isElderly,
  isLowStock,
  readOnly,
  canEditStock,
  isBusy,
  isStockBusy,
  expanded,
  onToggleExpanded,
  onAddStock,
  onTogglePause,
  onDelete,
  index,
}: MedicationCardProps) {
  const { Icon, label: formLabel } = doseFormOf(med.unit_type);
  const priority = priorityMeta(med.priority_level);

  // A paused medication drops to neutral. Its priority is still true but no
  // longer acting on anything, and a red "Critical" mark on a card that is not
  // reminding anyone is a claim the app cannot back up.
  const tone = med.active ? priority.tone : null;
  const accent = tone ? `var(--${tone}-strong)` : 'var(--muted-foreground)';
  const tint = tone ? `color-mix(in srgb, var(--${tone}) 12%, transparent)` : 'var(--muted)';

  // Same `current_stock ?? tablet_count` fallback the low-stock predicate, the
  // refill gate and the bot all use. A legacy row keeps its count in
  // tablet_count, and reading the raw column would print "not tracked" on a
  // medication the dashboard is simultaneously warning about.
  const stock = med.current_stock ?? med.tablet_count ?? null;

  const chip = `inline-flex items-center gap-1.5 font-semibold rounded-full whitespace-nowrap ${
    isElderly ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-1 text-[11px]'
  }`;

  return (
    <div
      data-tour={index === 0 ? 'med-card-first' : undefined}
      className={`rise-in relative bg-card rounded-[22px] overflow-hidden transition-transform duration-200 ease-out hover:-translate-y-0.5 ${
        med.active ? '' : 'opacity-70'
      }`}
      /* The dashboard's 60ms cascade, capped at 6 so a long list still finishes
         inside ~360ms — past that the last card arrives after you started reading. */
      style={{
        boxShadow: '0 1px 3px rgba(16, 28, 90, 0.04), 0 10px 30px rgba(16, 28, 90, 0.06)',
        ['--rise-delay' as string]: `${Math.min(index, 6) * 60}ms`,
      }}
    >
      <div className={isElderly ? 'px-5 pt-5 pb-4' : 'px-5 pt-4 pb-3.5'}>
        <div className="flex items-start gap-3.5">
          {/* Dose-form tile. Concentric: 16px inner against the card's 22px outer.
              The form is the fastest thing to recognise — you know your inhaler
              from your eye drops before you have read either name. */}
          <div
            className={`shrink-0 rounded-2xl flex items-center justify-center ${isElderly ? 'w-14 h-14' : 'w-12 h-12'}`}
            style={{ background: tint, color: accent }}
            title={formLabel}
          >
            <Icon className={isElderly ? 'w-7 h-7' : 'w-6 h-6'} />
            <span className="sr-only">{formLabel}</span>
          </div>

          <div className="flex-1 min-w-0">
            <h3
              className={`font-black tracking-[-0.01em] text-foreground ${
                isElderly ? 'text-2xl break-words' : 'text-xl truncate'
              }`}
            >
              {med.drug_name}
            </h3>

            {/* Strength and amount, labelled. "5 ml · 10mg" read as two competing
                numbers with nothing saying which was which. */}
            <p className={`text-muted-foreground font-medium mt-0.5 ${isElderly ? 'text-base' : 'text-[13px]'}`}>
              {med.dosage && med.dosage !== 'N/A'
                ? <>{med.dosage} · {med.dosage_amount || 1} {unitPhrase(med.unit_type, med.dosage_amount || 1)} per dose</>
                : <>{med.dosage_amount || 1} {unitPhrase(med.unit_type, med.dosage_amount || 1)} per dose</>}
            </p>

            {/* When. tabular-nums so a column of cards keeps its times aligned
                and digits do not shift width between 1:00 and 8:00. */}
            <p
              data-tour={index === 0 ? 'med-times' : undefined}
              className={`text-foreground/80 font-semibold mt-1 tabular-nums leading-snug ${
                isElderly ? 'text-base' : 'text-[13px]'
              }`}
            >
              {scheduleSummary(med.reminder_times, med.dose_days)}
            </p>

            {med.linked_brand_name && (
              <div className="mt-1.5">
                <button
                  type="button"
                  onClick={onToggleExpanded}
                  className="flex items-center gap-1 text-left w-full min-h-11 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
                  aria-expanded={expanded}
                  aria-label={`Catalog details for ${med.drug_name}`}
                >
                  <span className={`text-[11px] text-muted-foreground/80 font-medium flex-1 min-w-0 ${expanded ? '' : 'truncate'}`}>
                    {med.linked_brand_name}
                    {med.linked_composition ? ` — ${med.linked_composition}` : ''}
                    {med.linked_is_discontinued && (
                      <span className="ml-1.5 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground align-middle">
                        Discontinued
                      </span>
                    )}
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-muted-foreground/60 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
                    aria-hidden
                  />
                </button>
                {expanded && med.linked_manufacturer && (
                  <p className="text-[9px] text-muted-foreground/70">Manufacturer: {med.linked_manufacturer}</p>
                )}
                {/* "Patient-selected" is load-bearing: the catalog link is only ever
                    made by an explicit human choice, never by matching a nickname. */}
                <span className="block text-[9px] text-muted-foreground/70 mt-0.5">
                  Patient-selected from catalog · as of {med.linked_snapshot_date}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* STATUS ROW — full width, so it never has to wrap. Every chip pairs a
            colour with a WORD; colour alone is not a status. */}
        <div data-tour={index === 0 ? 'med-stock' : undefined} className="flex items-center gap-1.5 mt-3 flex-wrap">
          <span className={chip} style={{ background: tint, color: accent }}>
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: accent }} aria-hidden />
            {priority.label}
          </span>

          {!med.active && (
            <span className={`${chip} bg-muted text-muted-foreground`}>Paused</span>
          )}

          {stock !== null ? (
            <span
              className={`${chip} ${
                isLowStock
                  ? 'bg-warning/15 text-warning-strong'
                  : 'bg-muted text-muted-foreground'
              } tabular-nums`}
            >
              {isLowStock && <Package className="w-3 h-3 shrink-0" aria-hidden />}
              {stock} {unitPhrase(med.unit_type, Number(stock))} left
            </span>
          ) : (
            <span className={`${chip} bg-muted text-muted-foreground`}>Stock not tracked</span>
          )}
        </div>
      </div>

      {!readOnly && (
        <>
          <div className="h-px bg-border mx-5" />
          {/* Add stock is the action people take here weekly, so it gets a WORD.
              It was a 36px circle with a "+" in it, indistinguishable at a glance
              from the three circles beside it. */}
          <div className="px-5 py-3 flex items-center justify-between gap-2">
            {canEditStock ? (
              <button
                type="button"
                onClick={onAddStock}
                disabled={isStockBusy}
                className={`inline-flex items-center gap-1.5 rounded-full bg-muted font-semibold text-foreground hover:bg-accent-surface transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isElderly ? 'h-14 px-5 text-base' : 'h-11 px-4 text-[13px]'
                }`}
              >
                <Plus className="w-4 h-4 shrink-0" strokeWidth={2.5} aria-hidden />
                {isStockBusy ? 'Adding…' : 'Add stock'}
              </button>
            ) : (
              <span />
            )}

            <div data-tour={index === 0 ? 'med-actions' : undefined} className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onTogglePause}
                disabled={isBusy}
                aria-label={`${med.active ? 'Pause' : 'Resume'} reminders for ${med.drug_name}`}
                className={iconButtonClasses({ isElderly, className: isBusy ? 'animate-pulse' : '' })}
              >
                {med.active
                  ? <Pause className="w-4 h-4" strokeWidth={2.5} aria-hidden />
                  : <Play className="w-4 h-4" strokeWidth={2.5} aria-hidden />}
              </button>

              <Link
                href={`/medications/${med.id}`}
                aria-label={`Edit ${med.drug_name}`}
                className={iconButtonClasses({ isElderly })}
              >
                <SquarePen className="w-4 h-4" strokeWidth={2.5} aria-hidden />
              </Link>

              <span className="w-px self-stretch bg-border mx-1" aria-hidden />

              <button
                type="button"
                onClick={onDelete}
                disabled={isBusy}
                aria-label={`Delete ${med.drug_name}`}
                className={iconButtonClasses({ variant: 'danger-ghost', isElderly })}
              >
                <Trash2 className="w-4 h-4" strokeWidth={2.5} aria-hidden />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
