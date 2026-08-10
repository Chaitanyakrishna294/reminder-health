// Ported 2026-08-10/11 from the algorithm spec documented in src/utils.js's
// comments and test/schedule-test-vectors.json — NOT by transcribing the JS
// line-by-line. Must pass CalculateNextReminderTest.kt, which runs the exact
// same fixture the bot (test/utils.test.js) and web
// (web/src/lib/medication-utils.test.ts) engines already pass.
package com.reminderhealth.app.schedule

import java.time.Instant
import java.time.ZoneId

/** Mirrors src/utils.js DEFAULT_TIMEZONE / web/src/lib/medication-utils.ts DEFAULT_TIMEZONE. */
const val DEFAULT_TIMEZONE = "Asia/Kolkata"

/**
 * Thrown when [reminderTimes] is empty. Mirrors the JS engines' deliberate
 * throw-on-empty contract (src/utils.js's own comment: "callers must
 * pre-filter... treat a throw as 'do not advance'"). This must stay
 * unreachable in practice — callers are responsible for pre-filtering an
 * empty/null reminder_times array before calling, exactly like
 * src/scheduler.js's DATA PROBLEM guard and the equivalent guards added to
 * web/src/app/api/cron/tick/route.ts and the medication forms (2026-08-10).
 */
class EmptyReminderTimesException :
    IllegalStateException("reminderTimes must not be empty — callers must pre-filter")

/**
 * Calculate the next reminder fire instant for a set of daily "HH:MM" times,
 * interpreted as wall-clock time in [timezone].
 *
 * Port of calculateNextReminder (src/utils.js / web/src/lib/medication-utils.ts).
 * Must stay in lockstep with both — see test/schedule-test-vectors.json,
 * which all three implementations are expected to pass identically.
 *
 * [timezone] is passed straight to `ZoneId.of` with no special-casing: the
 * JDK's bundled tzdata already resolves legacy IANA aliases (e.g.
 * "Asia/Calcutta") to byte-identical DST rules as their canonical name
 * ("Asia/Kolkata") — verified directly against this JDK
 * (`ZoneId.of("Asia/Calcutta").getRules() == ZoneId.of("Asia/Kolkata").getRules()`
 * -> true) before relying on it here, since live medication rows hold both
 * spellings (browser-guessed alias vs. canonical).
 *
 * @param reminderTimes daily reminder times, e.g. ["08:00", "20:00"]. Must be
 *   non-empty — see [EmptyReminderTimesException].
 * @param timezone IANA tz of the medication (e.g. "Asia/Kolkata"); null/blank
 *   falls back to [DEFAULT_TIMEZONE].
 * @param doseDays weekdays the medication is due, 0=Sunday..6=Saturday
 *   (matches medications.dose_days and both JS engines' numbering — NOT
 *   java.time.DayOfWeek's Monday=1..Sunday=7, see the conversion below).
 *   Null/empty means every day.
 * @param now overrides "now" for tests (schedule-test-vectors.json). Omit in
 *   production — defaults to the real current instant, so this is a no-op
 *   for every real caller, same pattern as the JS engines' 4th `now` param.
 * @return the next fire instant, in UTC.
 */
fun calculateNextReminder(
    reminderTimes: List<String>,
    timezone: String?,
    doseDays: List<Int>?,
    now: Instant = Instant.now(),
): Instant {
    val tz = if (!timezone.isNullOrBlank()) ZoneId.of(timezone) else ZoneId.of(DEFAULT_TIMEZONE)
    val nowInTz = now.atZone(tz)

    val sortedTimes = reminderTimes.sorted()
    val days = doseDays?.takeIf { it.isNotEmpty() }

    // Walk forward from today until a due weekday has a time still in the
    // future. Offset 0 is "later today"; offsets 1..7 cover all seven
    // weekdays, so any non-empty `days` set is guaranteed a hit (a
    // once-weekly medication whose time already passed today lands on
    // offset 7 — the SAME weekday next week, not a fortnight out).
    for (offset in 0..7) {
        val day = nowInTz.plusDays(offset.toLong())

        // java.time.DayOfWeek is MONDAY=1..SUNDAY=7. The rest of this system
        // (medications.dose_days, moment().day() in both JS engines) uses
        // 0=Sunday..6=Saturday. `value % 7` converts correctly in both
        // directions: MONDAY(1)->1 .. SATURDAY(6)->6, SUNDAY(7)->0.
        val jsWeekday = day.dayOfWeek.value % 7
        if (days != null && jsWeekday !in days) continue

        for (timeStr in sortedTimes) {
            val (hour, minute) = timeStr.split(":").let { it[0].toInt() to it[1].toInt() }
            // .withHour/.withMinute on a day already advanced by .plusDays
            // keeps the wall-clock time stable across a DST transition —
            // move the calendar day first, then pin the time — identical to
            // both JS engines' `.add(offset,'day').set({hour,...})` ordering.
            val candidate = day.withHour(hour).withMinute(minute).withSecond(0).withNano(0)
            if (candidate.isAfter(nowInTz)) {
                return candidate.toInstant()
            }
        }
    }

    // Unreachable for valid data (the DB CHECK constrains dose_days to 1..7
    // entries within 0..6; reached only for a garbage set like {9}, which
    // matches no weekday). Falls back to tomorrow at the first sorted time —
    // one dose too many is a far safer failure than a patient never
    // reminded again. Also where the empty-reminderTimes contract lives:
    // sortedTimes.isEmpty() here means the loop above never found a
    // candidate for ANY offset (every inner loop was a no-op), so this is
    // reached and throws — deliberately, matching both JS engines.
    if (sortedTimes.isEmpty()) {
        throw EmptyReminderTimesException()
    }
    val (firstHour, firstMinute) = sortedTimes[0].split(":").let { it[0].toInt() to it[1].toInt() }
    val tomorrowFirst = nowInTz.plusDays(1).withHour(firstHour).withMinute(firstMinute).withSecond(0).withNano(0)
    return tomorrowFirst.toInstant()
}
