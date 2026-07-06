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

module.exports = {
  dosesPerDay,
  buildDoseKeyboard,
  buildTakePromptMessage,
};
