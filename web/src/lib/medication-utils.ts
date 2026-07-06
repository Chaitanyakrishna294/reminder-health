import moment from 'moment-timezone';

// Default timezone when a medication has none set. Must stay in lockstep with the
// bot's src/utils.js DEFAULT_TIMEZONE — both engines interpret each HH:MM reminder
// time as wall-clock time in the medication's own timezone, falling back to IST.
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/**
 * Calculate the next reminder fire time (as a UTC Date) for a set of daily HH:MM
 * times, interpreted in the medication's own timezone.
 *
 * This is the web mirror of the bot's `calculateNextReminder` (src/utils.js): same
 * algorithm, same default. Callers that omit `timezone` get the historical IST
 * behavior unchanged; passing a medication's stored `timezone` keeps the value the
 * web writes to `next_reminder_at` consistent with what the scheduler computes.
 *
 * @param timesArray Array of HH:MM strings (e.g. ['08:00', '20:00'])
 * @param timezone   IANA tz of the medication; defaults to IST
 * @returns Date in UTC
 */
export const calculateNextReminder = (
  timesArray: string[],
  timezone?: string,
): Date => {
  if (!timesArray || timesArray.length === 0) {
    return new Date();
  }

  const tz = timezone && timezone.trim() ? timezone : DEFAULT_TIMEZONE;
  const now = moment().tz(tz);

  // Sort times chronologically (e.g. ['08:00', '20:00'])
  const sortedTimes = [...timesArray].sort((a, b) => a.localeCompare(b));

  // Find next future reminder today
  for (const timeStr of sortedTimes) {
    const [hours, minutes] = timeStr.split(':').map(Number);

    const candidate = moment()
      .tz(tz)
      .set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });

    if (candidate.isAfter(now)) {
      return candidate.utc().toDate();
    }
  }

  // Otherwise schedule first reminder tomorrow
  const [firstHours, firstMinutes] = sortedTimes[0].split(':').map(Number);

  const tomorrowFirst = moment()
    .tz(tz)
    .add(1, 'day')
    .set({ hour: firstHours, minute: firstMinutes, second: 0, millisecond: 0 });

  return tomorrowFirst.utc().toDate();
};
