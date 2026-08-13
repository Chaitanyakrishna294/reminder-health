// Shared option/step data for the medication wizard, used by both the "new" and
// "edit" forms. These arrays were previously copy-pasted identically in both pages;
// the two pages still own their own markup and styling (which have intentionally
// diverged), so only this presentation-neutral data is shared here.

import React from 'react';
import {
  Pill,
  Clock,
  Layers,
  ShieldAlert,
  Beaker,
  Droplets,
  Syringe,
  Wind,
  Package,
  Bandage,
  Sun,
  CloudSun,
  Moon,
  ShieldCheck,
  AlertTriangle,
  CircleAlert,
  ClipboardList,
} from 'lucide-react';
import { SpoonIcon, CreamBottleIcon, TabletIcon } from '@/components/ui/custom-icons';
import { PRIORITY } from '@/lib/design/semantics';

export type UnitType =
  | 'TABLET'
  | 'CAPSULE'
  | 'ML'
  | 'DROP'
  | 'APPLICATION'
  | 'TEASPOON'
  | 'UNIT'
  | 'PATCH'
  | 'INHALATION'
  | 'OTHER';

export interface UnitOption {
  id: UnitType;
  label: string;
  icon: React.ReactNode;
}

export const unitOptions: UnitOption[] = [
  { id: 'TABLET', label: 'Tablet', icon: <TabletIcon className="w-5 h-5" /> },
  { id: 'CAPSULE', label: 'Capsule', icon: <Pill className="w-5 h-5" /> },
  { id: 'ML', label: 'Milliliter (ml)', icon: <Beaker className="w-5 h-5" /> },
  { id: 'DROP', label: 'Drop', icon: <Droplets className="w-5 h-5" /> },
  { id: 'APPLICATION', label: 'Application', icon: <CreamBottleIcon className="w-5 h-5" /> },
  { id: 'TEASPOON', label: 'Teaspoon', icon: <SpoonIcon className="w-5 h-5" /> },
  { id: 'UNIT', label: 'Unit', icon: <Syringe className="w-5 h-5" /> },
  { id: 'PATCH', label: 'Patch', icon: <Bandage className="w-5 h-5" /> },
  { id: 'INHALATION', label: 'Inhalation', icon: <Wind className="w-5 h-5" /> },
  { id: 'OTHER', label: 'Other', icon: <Package className="w-5 h-5" /> },
];

/** Quick-pick strengths, scoped to the form chosen in step 1. The picker used to offer
 *  `500mg / 650mg / 5mg / 10mg / 20mg / 100mcg` to everyone — so someone entering a
 *  syrup or an ointment was shown six tablet strengths and no useful option. Forms with
 *  no meaningful shorthand get an empty list and the chip row simply doesn't render. */
export const STRENGTH_SUGGESTIONS: Record<UnitType, string[]> = {
  TABLET: ['500mg', '650mg', '5mg', '10mg', '20mg', '100mcg'],
  CAPSULE: ['500mg', '250mg', '10mg', '20mg', '100mcg'],
  ML: ['5ml', '10ml', '2.5ml', '125mg/5ml'],
  TEASPOON: ['5ml', '10ml'],
  DROP: ['0.5%', '1%'],
  APPLICATION: ['0.5%', '1%', '2%'],
  PATCH: ['5mg', '10mg', '25mcg/hr'],
  INHALATION: ['100mcg', '200mcg'],
  UNIT: ['10 units', '20 units', '40 units'],
  OTHER: [],
};

/** Singular, lowercase, no parenthetical — "milliliter", not "Milliliter (ml)". The
 *  wizard used to render the full label plus "(s)", producing "Milliliter (ml)(s)". */
export function unitLabel(unitType?: string): string {
  const id = (unitType || 'TABLET').toUpperCase();
  return (
    unitOptions.find((o) => o.id === id)?.label.replace(/\s*\(.*\)$/, '').toLowerCase() ||
    'tablet'
  );
}

/** Pluralised for the amount. Replaces the "(s)" suffix used across the wizard, the
 *  review screen and the medication list, which produced "1 tablet(s)". */
export function unitPhrase(unitType: string | undefined, amount: number): string {
  const singular = unitLabel(unitType);
  if (amount === 1) return singular;
  return singular.endsWith('h') || singular.endsWith('s')
    ? `${singular}es`
    : `${singular}s`;
}

// Step metadata for the premium stepper.
export const stepMeta = [
  { label: 'Details', icon: <Pill className="w-4 h-4" /> },
  { label: 'Schedule', icon: <Clock className="w-4 h-4" /> },
  { label: 'Dosage', icon: <Beaker className="w-4 h-4" /> },
  { label: 'Inventory', icon: <Layers className="w-4 h-4" /> },
  { label: 'Priority', icon: <ShieldAlert className="w-4 h-4" /> },
  { label: 'Review', icon: <ClipboardList className="w-4 h-4" /> },
];

// Day-of-week picker options. `id` is the value stored in medications.dose_days
// (0=Sunday..6=Saturday, matching Date#getDay() and moment().day() so nothing
// remaps). Sunday-first to match the Schedule Planner's month grid and weekOf().
// `short` is the toggle label; `full` is its accessible name.
export const weekdays = [
  { id: 0, short: 'S', full: 'Sunday' },
  { id: 1, short: 'M', full: 'Monday' },
  { id: 2, short: 'T', full: 'Tuesday' },
  { id: 3, short: 'W', full: 'Wednesday' },
  { id: 4, short: 'T', full: 'Thursday' },
  { id: 5, short: 'F', full: 'Friday' },
  { id: 6, short: 'S', full: 'Saturday' },
];

/** Human summary of a dose_days selection, for review screens and list rows. */
export function describeDoseDays(days: number[] | null | undefined): string {
  if (!days || days.length === 0 || days.length === 7) return 'Every day';
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 5 && sorted.every((d) => d >= 1 && d <= 5)) return 'Weekdays';
  if (sorted.length === 2 && sorted[0] === 0 && sorted[1] === 6) return 'Weekends';
  return sorted.map((d) => weekdays[d].full.slice(0, 3)).join(', ');
}

/** `"14:05"` → `"2:05 PM"`. Pure, so the card and the review screen agree. */
export function format12Hour(timeStr: string): string {
  const [hourStr, minStr] = (timeStr || '').split(':');
  const hour = parseInt(hourStr, 10);
  if (Number.isNaN(hour)) return timeStr;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${minStr} ${ampm}`;
}

/**
 * One line answering "when do I take this?" — `"8:00 AM · daily"`.
 *
 * Replaces a row of time pills plus a separate `once_daily` frequency chip. Those
 * said the same thing twice in two vocabularies: the pills gave the times, the
 * chip gave a count of them, and NEITHER mentioned which days — so a
 * Monday/Thursday medication read as "Twice Daily" on the card and surprised
 * someone on a Tuesday.
 *
 * Times lead, because the time is what gets checked against the clock in your
 * hand. The day pattern follows, because it only matters when it is not "daily".
 */
export function scheduleSummary(
  reminderTimes: string[] | null | undefined,
  doseDays: number[] | null | undefined,
): string {
  const times = (reminderTimes ?? []).filter(Boolean);
  // An empty reminder_times is a real state — the bot pre-filters these and the
  // forms now refuse to save one — so say so rather than printing "· daily"
  // beside nothing and implying a schedule that does not exist.
  if (times.length === 0) return 'No times set';

  const days = describeDoseDays(doseDays);
  // "Every day" becomes "daily" so the line reads as a phrase. A specific list
  // keeps its capitals — "Mon, Wed" is a set of names, not a word.
  const dayPhrase =
    days === 'Every day' ? 'daily'
      : days === 'Weekdays' ? 'weekdays'
        : days === 'Weekends' ? 'weekends'
          : days;

  return `${times.map(format12Hour).join(', ')} · ${dayPhrase}`;
}

export const frequencies = [
  { id: 'once_daily', title: 'Once Daily', desc: 'One dose per day', icon: <Sun className="w-5 h-5" /> },
  { id: 'twice_daily', title: 'Twice Daily', desc: 'Morning and night', icon: <CloudSun className="w-5 h-5" /> },
  { id: 'thrice_daily', title: 'Thrice Daily', desc: 'Morning, noon, and night', icon: <Moon className="w-5 h-5" /> },
];

// Labels and tones come from lib/design/semantics so the picker, the medication list and
// the planner's legend cannot drift apart again. Only the icons are local.
export const priorities = [
  { id: 'normal' as const, title: PRIORITY.normal.label, desc: PRIORITY.normal.desc, icon: <ShieldCheck className="w-5 h-5" />, color: PRIORITY.normal.tone },
  { id: 'important' as const, title: PRIORITY.important.label, desc: PRIORITY.important.desc, icon: <AlertTriangle className="w-5 h-5" />, color: PRIORITY.important.tone },
  { id: 'critical' as const, title: PRIORITY.critical.label, desc: PRIORITY.critical.desc, icon: <CircleAlert className="w-5 h-5" />, color: PRIORITY.critical.tone },
];
