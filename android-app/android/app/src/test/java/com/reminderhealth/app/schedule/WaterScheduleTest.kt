// Water nudge scheduling. The Kotlin half of lib/water/hydration.ts — the cases
// here mirror hydration.test.ts deliberately, because the settings screen shows
// the user a preview computed by the WEB and the phone computes it again with no
// network. If the two drift, the preview lies about what the device will do.
//
// Run: ./gradlew testDebugUnitTest --tests "*.WaterScheduleTest"
package com.reminderhealth.app.schedule

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

class WaterScheduleTest {

    private val kolkata = ZoneId.of("Asia/Kolkata")
    private fun m(hhmm: String) = WaterSchedule.minutesOfDay(hhmm)!!

    @Test
    fun spreadsCupsAcrossTheWindow() {
        // 08:00-21:00 is 780 minutes; 7 cups anchor both ends, 130 min apart.
        val times = WaterSchedule.nudgeTimes(m("08:00"), m("21:00"), 7)
        assertEquals(listOf("08:00", "10:10", "12:20", "14:30", "16:40", "18:50", "21:00"),
            times.map { String.format("%02d:%02d", it / 60, it % 60) })
    }

    /** A single reminder is more useful early, while there is still a day to drink in. */
    @Test
    fun oneCupGoesAtTheStart() {
        assertEquals(listOf(m("08:00")), WaterSchedule.nudgeTimes(m("08:00"), m("21:00"), 1))
    }

    /** An overnight window is clamped, not wrapped: a 3am water nudge is worse than a short day. */
    @Test
    fun anOvernightWindowDoesNotWrapPastMidnight() {
        val times = WaterSchedule.nudgeTimes(m("22:00"), m("06:00"), 3)
        assertTrue(times.all { it >= m("22:00") })
    }

    @Test
    fun aDuplicateMinuteIsNotTwoNotifications() {
        val times = WaterSchedule.nudgeTimes(m("08:00"), m("08:00"), 4)
        assertEquals(times.size, times.distinct().size)
    }

    @Test
    fun noCupsMeansNoNudges() {
        assertTrue(WaterSchedule.nudgeTimes(m("08:00"), m("21:00"), 0).isEmpty())
    }

    // -- WATER YIELDS TO MEDICINE --------------------------------------------

    @Test
    fun aNudgeNearADoseStepsAside() {
        val water = listOf(m("08:00"), m("10:10"), m("12:20"), m("14:30"))
        assertEquals(
            listOf(m("08:00"), m("10:10"), m("14:30")),
            WaterSchedule.withoutDoseClashes(water, listOf(m("12:15"))),
        )
    }

    @Test
    fun theBoundaryYields() {
        // "within" is inclusive — exactly 10 minutes away still steps aside.
        assertTrue(WaterSchedule.withoutDoseClashes(listOf(m("12:20")), listOf(m("12:30"))).isEmpty())
        assertEquals(1, WaterSchedule.withoutDoseClashes(listOf(m("12:20")), listOf(m("12:31"))).size)
    }

    /** DROPPED, never moved: moving puts the cup somewhere the user did not choose. */
    @Test
    fun aClashIsDroppedNotRescheduled() {
        val water = listOf(m("08:00"), m("10:10"))
        val kept = WaterSchedule.withoutDoseClashes(water, listOf(m("08:00")))
        assertEquals(listOf(m("10:10")), kept)
    }

    @Test
    fun noDosesMeansNothingToYieldTo() {
        val water = listOf(m("08:00"), m("10:10"))
        assertEquals(water, WaterSchedule.withoutDoseClashes(water, emptyList()))
    }

    // -- PICKING THE NEXT ONE -------------------------------------------------

    @Test
    fun findsTheNextNudgeLaterToday() {
        // 09:00 IST = 03:30 UTC.
        val now = Instant.parse("2026-08-14T03:30:00Z")
        val next = WaterSchedule.nextNudgeAfter(now, kolkata, listOf(m("08:00"), m("12:00"), m("18:00")))
        assertEquals(Instant.parse("2026-08-14T06:30:00Z"), next) // 12:00 IST
    }

    @Test
    fun rollsOverToTomorrowsFirstNudge() {
        // 22:00 IST = 16:30 UTC; nothing left today.
        val now = Instant.parse("2026-08-14T16:30:00Z")
        val next = WaterSchedule.nextNudgeAfter(now, kolkata, listOf(m("08:00"), m("12:00")))
        assertEquals(Instant.parse("2026-08-15T02:30:00Z"), next) // 08:00 IST tomorrow
    }

    @Test
    fun anEmptyScheduleHasNoNext() {
        assertNull(WaterSchedule.nextNudgeAfter(Instant.now(), kolkata, emptyList()))
    }

    /** The delay never goes negative, or WorkManager would fire instantly in a loop. */
    @Test
    fun delayIsNeverNegative() {
        val now = Instant.parse("2026-08-14T10:00:00Z")
        val past = Instant.parse("2026-08-14T09:00:00Z")
        assertTrue(WaterSchedule.delayUntil(now, past).isZero)
    }

    @Test
    fun parsesAndRejectsTimes() {
        assertEquals(480, WaterSchedule.minutesOfDay("08:00"))
        assertEquals(485, WaterSchedule.minutesOfDay("8:05"))
        assertNull(WaterSchedule.minutesOfDay("24:00"))
        assertNull(WaterSchedule.minutesOfDay("nope"))
    }
}
