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

/**
 * Calculate next reminder in IST timezone
 * @param {string[]} timesArray
 * @returns {Date}
 */
const calculateNextReminder = (timesArray) => {
  const now = moment().tz('Asia/Kolkata');

  // Sort times
  const sortedTimes = [...timesArray].sort((a, b) => a.localeCompare(b));

  // Find next future reminder today
  for (const timeStr of sortedTimes) {
    const [hours, minutes] = timeStr.split(':').map(Number);

    const candidate = moment()
      .tz('Asia/Kolkata')
      .set({
        hour: hours,
        minute: minutes,
        second: 0,
        millisecond: 0
      });

    if (candidate.isAfter(now)) {
      return candidate.toDate();
    }
  }

  // Otherwise schedule first reminder tomorrow
  const [firstHours, firstMinutes] = sortedTimes[0].split(':').map(Number);

  const tomorrowFirst = moment()
    .tz('Asia/Kolkata')
    .add(1, 'day')
    .set({
      hour: firstHours,
      minute: firstMinutes,
      second: 0,
      millisecond: 0
    });

  return tomorrowFirst.toDate();
};

// In-memory snooze tracking
const activeSnoozes = {};

module.exports = {
  delay,
  isValidTime,
  calculateNextReminder,
  activeSnoozes
};
