// Shared reminder-notification builders for the Telegram scheduler.
//
// These were previously inlined and copy-pasted across several call sites in
// scheduler.js (initial send, gentle reminder, snooze expiry) and the low-stock
// math was duplicated between the daily low-stock job and the caregiver summary.
// Centralizing them here keeps the button layout, the "time to take" copy, and the
// doses-per-day mapping defined in exactly one place. Pure functions — no I/O — so
// they are cheap to unit-test and carry no behavioral change versus the originals.

const { CALLBACK_ACTIONS, MAX_SNOOZES } = require('./constants');
const { escapeHTML } = require('./utils');

/**
 * Doses taken per day for a given frequency. Unknown/legacy frequencies fall back
 * to 1 (matching the prior inline `... : 1` default).
 * @param {string} frequency
 * @returns {number}
 */
const dosesPerDay = (frequency) => {
  switch (frequency) {
    case 'twice_daily':
      return 2;
    case 'thrice_daily':
      return 3;
    case 'once_daily':
    default:
      return 1;
  }
};

/**
 * Build the inline keyboard shown on a due/gentle/snooze reminder: TAKEN + SKIP,
 * with a "Snooze 10m" button inserted between them while the user is still under
 * the snooze cap. Identical layout to the prior inline copies.
 * @param {number|string} medicationId
 * @param {number} scheduledTimeMs  epoch ms of the dose (callback payload)
 * @param {number} [snoozeCount=0]
 * @returns {{ inline_keyboard: Array<Array<{text:string, callback_data:string}>> }}
 */
const buildDoseKeyboard = (medicationId, scheduledTimeMs, snoozeCount = 0) => {
  const buttons = [
    { text: '✅ TAKEN', callback_data: `${CALLBACK_ACTIONS.TAKEN}:${medicationId}:${scheduledTimeMs}` },
    { text: '⏭ SKIP', callback_data: `${CALLBACK_ACTIONS.SKIP}:${medicationId}:${scheduledTimeMs}` },
  ];

  if (snoozeCount < MAX_SNOOZES) {
    buttons.splice(1, 0, {
      text: '⏰ Snooze 10m',
      callback_data: `${CALLBACK_ACTIONS.SNOOZE}:${medicationId}:${scheduledTimeMs}`,
    });
  }

  return { inline_keyboard: [buttons] };
};

/**
 * The standard "time to take X (dosage)" prompt used by the initial send and the
 * snooze-expiry re-send. HTML-escaped for Telegram's HTML parse mode.
 * @param {string} drugName
 * @param {string} [dosage]
 * @returns {string}
 */
const buildTakePromptMessage = (drugName, dosage) =>
  `💊 Time to take <b>${escapeHTML(drugName)}</b>${dosage ? ` (${escapeHTML(dosage)})` : ''}`;

/**
 * Days of stock remaining for a medication, or null when stock tracking is off
 * (no stock value recorded). Reads current_stock (source of truth; tablet_count
 * is a floored mirror kept by a DB trigger) and accounts for dosage_amount —
 * a med taken 2 tablets × 2 times a day burns 4/day, not 2.
 * @param {{current_stock?: number|null, tablet_count?: number|null, frequency: string, dosage_amount?: number|null}} med
 * @returns {number|null}
 */
const daysOfStockLeft = (med) => {
  const stock = med.current_stock ?? med.tablet_count;
  if (stock === null || stock === undefined) return null;
  const perDay = dosesPerDay(med.frequency) * (Number(med.dosage_amount) || 1);
  return Math.floor(stock / perDay);
};

/** Days of remaining stock at or below which a medication counts as low, when no
 *  usable stock_threshold is set — and as a backup when the threshold is so small
 *  it would give almost no warning (threshold 2 on a 4-doses-a-day med is half a day). */
const LOW_STOCK_DAYS = 3;

/**
 * The single definition of "this medication needs refilling".
 *
 * Before this existed there were three: the 09:00 cron used `daysOfStockLeft <= 3`,
 * the web dashboard re-typed the same math inline, and the medication card badge used
 * `current_stock <= stock_threshold` — so the threshold the user set in the wizard,
 * under the promise "You will receive an alert when stock reaches this amount",
 * drove one badge and no alert at all.
 *
 * Mirrored in web/src/lib/medications/stock.ts; both are run against
 * test/fixtures/low-stock-cases.json so they cannot drift apart silently.
 *
 * `reason` exists so copy can be honest: "4 left, you asked to be warned at 4" and
 * "about 2 days left" are different sentences and one generic string is wrong half
 * the time.
 *
 * @param {{active?: boolean, low_stock_alert_enabled?: boolean, current_stock?: number|null,
 *          tablet_count?: number|null, stock_threshold?: number|null, frequency: string,
 *          dosage_amount?: number|null}} med
 * @returns {{low: boolean, reason: 'threshold'|'days'|null, stock: number|null,
 *            daysLeft: number|null, threshold: number|null}}
 */
const isLowStock = (med) => {
  const threshold = med.stock_threshold ?? null;
  const stock = med.current_stock ?? med.tablet_count ?? null;
  const idle = { low: false, reason: null, stock, daysLeft: null, threshold };

  // `active` is undefined when the caller did not select the column; every such
  // caller has already filtered to active rows, so absent means active.
  if (med.active === false) return idle;
  if (!med.low_stock_alert_enabled) return idle;
  if (stock === null || stock === undefined) return idle;

  const daysLeft = daysOfStockLeft(med);
  const base = { ...idle, daysLeft };

  if (threshold !== null && threshold !== undefined && Number(stock) <= Number(threshold)) {
    return { ...base, low: true, reason: 'threshold' };
  }
  if (daysLeft !== null && daysLeft <= LOW_STOCK_DAYS) {
    return { ...base, low: true, reason: 'days' };
  }
  return base;
};

module.exports = {
  dosesPerDay,
  buildDoseKeyboard,
  buildTakePromptMessage,
  daysOfStockLeft,
  LOW_STOCK_DAYS,
  isLowStock,
};
