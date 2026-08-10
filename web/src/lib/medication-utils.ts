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
 * `doseDays` is the medication's `dose_days` column: which weekdays it is due
 * on, 0=Sunday .. 6=Saturday (moment().day() numbering). Null/undefined/empty
 * means EVERY DAY, which is every medication saved before the column existed.
 *
 * @param timesArray Array of HH:MM strings (e.g. ['08:00', '20:00'])
 * @param timezone   IANA tz of the medication; defaults to IST
 * @param doseDays   Weekdays the med is due, 0=Sun..6=Sat; empty/omitted = daily
 * @param now        Anything moment() accepts; overrides "now" for tests
 *                    (schedule-test-vectors.json). Omit in production —
 *                    moment(undefined) is the current time, so this is a
 *                    no-op for every real caller.
 * @returns Date in UTC
 */
export const calculateNextReminder = (
  timesArray: string[],
  timezone?: string,
  doseDays?: number[] | null,
  now?: Date | string | number,
): Date => {
  const tz = timezone && timezone.trim() ? timezone : DEFAULT_TIMEZONE;
  const nowInTz = moment(now).tz(tz);

  // Sort times chronologically (e.g. ['08:00', '20:00'])
  const sortedTimes = [...timesArray].sort((a, b) => a.localeCompare(b));

  const days = Array.isArray(doseDays) && doseDays.length > 0 ? doseDays : null;

  // Walk forward from today until a due weekday has a time still in the future.
  // Eight iterations: offset 0 is "later today", offsets 1..7 cover all seven
  // weekdays, so any non-empty `days` is guaranteed a hit (a once-weekly med
  // whose time already passed today lands on offset 7). `.add(offset,'day')`
  // then `.set({hour...})` keeps the wall-clock time stable across a DST
  // transition — identical to the bot's src/utils.js.
  for (let offset = 0; offset <= 7; offset++) {
    const day = moment(now).tz(tz).add(offset, 'day');
    if (days && !days.includes(day.day())) continue;

    for (const timeStr of sortedTimes) {
      const [hours, minutes] = timeStr.split(':').map(Number);

      const candidate = day
        .clone()
        .set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });

      if (candidate.isAfter(nowInTz)) {
        return candidate.utc().toDate();
      }
    }
  }

  // Unreachable for valid data (the DB CHECK constrains dose_days to 1..7
  // entries within 0..6); reached only for a garbage set such as {9}, which
  // matches no weekday. Fall back to plain daily scheduling — for a medication
  // reminder, one dose too many beats a patient who is never reminded again.
  //
  // This also deliberately preserves the throw on an empty timesArray —
  // sortedTimes[0] is undefined and .split() raises. Every caller must guard
  // the empty case before calling (mirrors src/utils.js / src/scheduler.js;
  // see the DATA PROBLEM guards in medications/new, medications/[id]/edit-form,
  // and api/cron/tick). This used to silently return `new Date()` instead —
  // that was a confirmed drift from the bot's throwing behavior, see
  // schedule-test-vectors.json.
  const [firstHours, firstMinutes] = sortedTimes[0].split(':').map(Number);

  const tomorrowFirst = moment(now)
    .tz(tz)
    .add(1, 'day')
    .set({ hour: firstHours, minute: firstMinutes, second: 0, millisecond: 0 });

  return tomorrowFirst.utc().toDate();
};
