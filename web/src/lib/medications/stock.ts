// Web mirror of the bot's low-stock predicate (src/reminders.js).
//
// Kept in lockstep by test/fixtures/low-stock-cases.json, which both this file's
// test and test/reminders.test.js run through. If you change the rule here, change
// it there, and add the case to the fixture — otherwise one surface will warn a
// patient and the other will stay silent.
//
// See docs/superpowers/specs/2026-08-06-refill-reminder-design.md.

export const LOW_STOCK_DAYS = 3;

export type LowStockReason = 'threshold' | 'days';

export interface StockInput {
  active?: boolean | null;
  low_stock_alert_enabled?: boolean | null;
  current_stock?: number | null;
  tablet_count?: number | null;
  stock_threshold?: number | null;
  frequency?: string | null;
  dosage_amount?: number | null;
  /** Weekdays the med is due, 0=Sun..6=Sat. Null/absent = every day. */
  dose_days?: number[] | null;
}

export interface StockStatus {
  low: boolean;
  reason: LowStockReason | null;
  stock: number | null;
  daysLeft: number | null;
  threshold: number | null;
}

/** Serialisable row handed from the dashboard server component to the strip and gate. */
export interface LowStockMed {
  id: number;
  drug_name: string;
  unit_type: string | null;
  stock: number;
  threshold: number | null;
  daysLeft: number | null;
  reason: LowStockReason;
}

export function dosesPerDay(frequency?: string | null): number {
  switch (frequency) {
    case 'twice_daily': return 2;
    case 'thrice_daily': return 3;
    default: return 1;
  }
}

/** Days of stock left, or null when stock tracking is off. Burn rate includes
 *  dosage_amount — 2 tablets twice a day burns 4/day, not 2 — and dose_days,
 *  because a medication taken 3 days a week lasts well over twice as long as the
 *  same medication taken daily. Without that second factor a weekly med reports
 *  "2 days left" while the patient still has a fortnight of it, and the refill
 *  cron nags every single day. */
export function daysOfStockLeft(med: StockInput): number | null {
  const stock = med.current_stock ?? med.tablet_count ?? null;
  if (stock === null || stock === undefined) return null;
  const perDueDay = dosesPerDay(med.frequency) * (Number(med.dosage_amount) || 1);
  const dueDaysPerWeek =
    Array.isArray(med.dose_days) && med.dose_days.length > 0 ? med.dose_days.length : 7;
  // Multiplied out rather than scaling by (7/dueDaysPerWeek) so the daily case
  // (7/7) stays exactly the old integer division and the shared fixture holds.
  return Math.floor((Number(stock) * 7) / (perDueDay * dueDaysPerWeek));
}

export function isLowStock(med: StockInput): StockStatus {
  const threshold = med.stock_threshold ?? null;
  const stock = med.current_stock ?? med.tablet_count ?? null;
  const idle: StockStatus = { low: false, reason: null, stock, daysLeft: null, threshold };

  // `active` is undefined when the caller did not select the column; every such
  // caller has already filtered to active rows, so absent means active.
  if (med.active === false) return idle;
  if (!med.low_stock_alert_enabled) return idle;
  if (stock === null || stock === undefined) return idle;

  const daysLeft = daysOfStockLeft(med);
  const base: StockStatus = { ...idle, daysLeft };

  if (threshold !== null && threshold !== undefined && Number(stock) <= Number(threshold)) {
    return { ...base, low: true, reason: 'threshold' };
  }
  if (daysLeft !== null && daysLeft <= LOW_STOCK_DAYS) {
    return { ...base, low: true, reason: 'days' };
  }
  return base;
}

/** One honest sentence about why this medication is low. */
export function lowStockReasonText(med: LowStockMed, unitLabel: string): string {
  if (med.stock === 0) return `None left`;
  if (med.reason === 'threshold' && med.threshold !== null) {
    return `${med.stock} ${unitLabel} left — you asked to be warned at ${med.threshold}`;
  }
  const d = med.daysLeft ?? 0;
  return `${med.stock} ${unitLabel} left — about ${d} ${d === 1 ? 'day' : 'days'}`;
}
