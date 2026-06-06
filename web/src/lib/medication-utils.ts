import moment from 'moment-timezone';

/**
 * Calculate next reminder in IST timezone (Asia/Kolkata)
 * Matches bot scheduling engine perfectly.
 * @param timesArray Array of HH:MM strings (e.g. ['08:00', '20:00'])
 * @returns Date in UTC
 */
export const calculateNextReminder = (timesArray: string[]): Date => {
  if (!timesArray || timesArray.length === 0) {
    return new Date();
  }

  const now = moment().tz('Asia/Kolkata');

  // Sort times chronologically (e.g. ['08:00', '20:00'])
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
      return candidate.utc().toDate();
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

  return tomorrowFirst.utc().toDate();
};
