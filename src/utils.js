const moment = require('moment-timezone');
/**
 * Delay execution for a given number of milliseconds
 * @param {number} ms
 * @returns {Promise<void>}
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Validates HH:MM 24-hour format
 * @param {string} timeStr
 * @returns {boolean}
 */
const isValidTime = (timeStr) => {
  const regex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  return regex.test(timeStr);
};

// Default timezone when a medication has none set. Every reminder time string is
// interpreted as wall-clock time in the medication's own timezone.
const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/**
 * Calculate the next reminder fire time (as a UTC Date) for a set of HH:MM
 * times, interpreted in the medication's own timezone.
 *
 * `doseDays` is the medication's `dose_days` column: which weekdays it is due
 * on, 0=Sunday .. 6=Saturday (moment().day() numbering, no remapping needed).
 * Null/undefined/empty means EVERY DAY — that is every medication saved before
 * the column existed, so the permissive default is what keeps them firing.
 *
 * Must stay in lockstep with the web mirror in
 * web/src/lib/medication-utils.ts and with `occursOn` in
 * web/src/lib/schedule/dose-engine.ts (which projects the same rule onto the
 * dashboard and Schedule Planner). If they disagree, the UI shows a dose on a
 * day this function never schedules.
 *
 * @param {string[]} timesArray  daily reminder times in 'HH:MM'
 * @param {string} [timezone]    IANA tz of the medication; defaults to IST
 * @param {number[]} [doseDays]  weekdays the med is due, 0=Sun..6=Sat; empty/omitted = daily
 * @returns {Date}
 */
const calculateNextReminder = (timesArray, timezone, doseDays) => {
  const tz = timezone && timezone.trim() ? timezone : DEFAULT_TIMEZONE;
  const now = moment().tz(tz);

  // Sort times
  const sortedTimes = [...timesArray].sort((a, b) => a.localeCompare(b));

  const days = Array.isArray(doseDays) && doseDays.length > 0 ? doseDays : null;

  // Walk forward from today until a due weekday has a time still in the future.
  // Eight iterations: offset 0 is "later today", and offsets 1..7 cover all
  // seven weekdays, so any non-empty `days` is guaranteed a hit (a once-weekly
  // med whose time already passed today lands on offset 7 — same weekday next
  // week). `.add(offset,'day').set({hour...})` keeps the existing DST
  // semantics: move the calendar day first, then pin the wall-clock time, so a
  // reminder stays at 08:00 local across a transition.
  for (let offset = 0; offset <= 7; offset++) {
    const day = moment().tz(tz).add(offset, 'day');
    if (days && !days.includes(day.day())) continue;

    for (const timeStr of sortedTimes) {
      const [hours, minutes] = timeStr.split(':').map(Number);

      const candidate = day.clone().set({
        hour: hours,
        minute: minutes,
        second: 0,
        millisecond: 0
      });

      if (candidate.isAfter(now)) {
        return candidate.utc().toDate();
      }
    }
  }

  // Unreachable for valid data (the DB CHECK constrains dose_days to 1..7
  // entries within 0..6). Reached only if a row holds a garbage set such as
  // {9}, in which case the loop above matches no weekday. Fall back to plain
  // daily scheduling: for a medication reminder, one dose too many is a far
  // safer failure than a patient who is never reminded again.
  //
  // This also deliberately preserves the long-standing throw on an empty
  // reminder_times array — sortedTimes[0] is undefined and .split() raises.
  // src/scheduler.js relies on that (it guards the empty case before calling,
  // see the DATA PROBLEM branch) and callers treat a throw as "do not advance".
  const [firstHours, firstMinutes] = sortedTimes[0].split(':').map(Number);

  const tomorrowFirst = moment()
    .tz(tz)
    .add(1, 'day')
    .set({
      hour: firstHours,
      minute: firstMinutes,
      second: 0,
      millisecond: 0
    });

  return tomorrowFirst.utc().toDate();
};

/**
 * HTML escape helper to prevent Telegram parsing errors
 * @param {any} val
 * @returns {string}
 */
const escapeHTML = (val) => {
  if (val === null || val === undefined) return '';
  const str = String(val);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

module.exports = {
  delay,
  isValidTime,
  calculateNextReminder,
  escapeHTML,
  DEFAULT_TIMEZONE
};

