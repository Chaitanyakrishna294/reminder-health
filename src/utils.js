/**
 * Delay execution for a given number of milliseconds
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Validates if the given string is a valid HH:MM 24-hour time
 * @param {string} timeStr - Time string to validate (e.g., "08:00")
 * @returns {boolean} - True if valid, false otherwise
 */
const isValidTime = (timeStr) => {
  const regex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  return regex.test(timeStr);
};

/**
 * Calculates the next reminder date/time based on current time and an array of requested HH:MM
 * Ensures the array is sorted chronologically.
 * @param {string[]} timesArray - Array of time strings in HH:MM format
 * @param {string} timezone - Timezone (default: Asia/Kolkata)
 * @returns {Date} - The Date object of the next reminder strictly in the future
 */
const calculateNextReminder = (timesArray, timezone = 'Asia/Kolkata') => {
  const now = new Date();
  
  // Sort chronologically as requested (e.g. "08:00", "14:00", "20:00")
  const sortedTimes = [...timesArray].sort((a, b) => a.localeCompare(b));

  for (const timeStr of sortedTimes) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const candidate = new Date(now);
    candidate.setHours(hours, minutes, 0, 0);
    
    // Find the very first time strictly greater than now
    if (candidate > now) {
      return candidate;
    }
  }

  // If all times for today have already passed, schedule for the first time tomorrow
  const [firstHours, firstMinutes] = sortedTimes[0].split(':').map(Number);
  const tomorrowFirst = new Date(now);
  tomorrowFirst.setDate(tomorrowFirst.getDate() + 1);
  tomorrowFirst.setHours(firstHours, firstMinutes, 0, 0);
  
  return tomorrowFirst;
};

// In-memory store for snooze counts
const activeSnoozes = {};

module.exports = {
  delay,
  isValidTime,
  calculateNextReminder,
  activeSnoozes
};
