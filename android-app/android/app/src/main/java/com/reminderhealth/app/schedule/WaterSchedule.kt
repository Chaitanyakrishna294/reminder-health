package com.reminderhealth.app.schedule

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/**
 * WHEN TO NUDGE ABOUT WATER — the Kotlin half of `lib/water/hydration.ts`.
 *
 * Same rules, same reasons, deliberately kept small enough to read beside the
 * TypeScript. The web computes these for the settings preview; the device
 * computes them again because it has to work with no network, and both must
 * agree or the preview lies about what the phone will do.
 *
 * **Everything here is INEXACT.** Exact alarms are medication-only — a hard rule
 * in CLAUDE.md — and a glass of water does not earn one. These times are targets
 * for a WorkManager job that Android is free to shift.
 */
object WaterSchedule {

    /** A nudge this close to a dose steps aside. Water never competes with medicine. */
    const val DOSE_YIELD_MINUTES = 10L

    /**
     * Cups spread evenly across the drinking window.
     *
     * First cup at the start, last at the end, the rest evenly between: a window
     * is someone saying "I am awake between these hours", so nudges that drift
     * past the end are nudges arriving at bedtime.
     *
     * ONE cup goes at the START, not the middle — a single reminder is more
     * useful early, while there is still a day left to drink in.
     */
    fun nudgeTimes(startMinutes: Int, endMinutes: Int, cups: Int): List<Int> {
        if (cups < 1) return emptyList()
        // A window that ends before it starts (an overnight shift) is clamped to
        // midnight rather than wrapped: a hydration nudge at 3am is a worse
        // failure than a slightly short window.
        val last = if (endMinutes > startMinutes) endMinutes else 1439
        if (cups == 1) return listOf(startMinutes)

        val step = (last - startMinutes).toDouble() / (cups - 1)
        // distinct(): two cups in a very short window can round onto the same
        // minute, and a duplicate is two notifications for one cup.
        return (0 until cups).map { (startMinutes + step * it).toInt() }.distinct()
    }

    /**
     * WATER YIELDS TO MEDICINE.
     *
     * A nudge within [DOSE_YIELD_MINUTES] of a dose is DROPPED, not moved. Moving
     * it would put the cup somewhere the user did not choose and can cascade into
     * the next one; dropping costs a single glass, which is the cheapest thing on
     * the screen.
     */
    fun withoutDoseClashes(
        waterMinutes: List<Int>,
        doseMinutes: List<Int>,
        within: Long = DOSE_YIELD_MINUTES,
    ): List<Int> {
        if (doseMinutes.isEmpty()) return waterMinutes
        return waterMinutes.filter { at ->
            doseMinutes.none { dose -> Math.abs(dose - at) <= within }
        }
    }

    /** "HH:MM" -> minutes from midnight, or null when unparseable. */
    fun minutesOfDay(hhmm: String): Int? {
        val m = Regex("""^(\d{1,2}):(\d{2})$""").find(hhmm.trim()) ?: return null
        val h = m.groupValues[1].toInt()
        val min = m.groupValues[2].toInt()
        if (h !in 0..23 || min !in 0..59) return null
        return h * 60 + min
    }

    /**
     * The next nudge after [from], or null when the day has none left.
     *
     * Returns an INSTANT so the worker can be scheduled with a delay; the times
     * themselves are wall-clock, because a drinking window is a wall-clock idea.
     */
    fun nextNudgeAfter(
        from: Instant,
        zone: ZoneId,
        minutesOfDayList: List<Int>,
    ): Instant? {
        if (minutesOfDayList.isEmpty()) return null
        val local = from.atZone(zone)
        val today = local.toLocalDate()
        val nowMinutes = local.hour * 60 + local.minute

        minutesOfDayList.sorted().firstOrNull { it > nowMinutes }?.let {
            return at(today, it, zone)
        }
        // Nothing left today — the first nudge of tomorrow.
        return at(today.plusDays(1), minutesOfDayList.min(), zone)
    }

    private fun at(date: LocalDate, minutes: Int, zone: ZoneId): Instant =
        date.atTime(LocalTime.of(minutes / 60, minutes % 60)).atZone(zone).toInstant()

    /** How long from [from] until [target]; never negative. */
    fun delayUntil(from: Instant, target: Instant): Duration {
        val d = Duration.between(from, target)
        return if (d.isNegative) Duration.ZERO else d
    }
}
