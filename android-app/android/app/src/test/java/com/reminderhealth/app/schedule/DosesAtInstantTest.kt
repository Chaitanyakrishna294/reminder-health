// Local JVM unit test. Covers the derivation the coalesced alarm screen is built
// on: given an instant, WHICH medications are due then and still unanswered.
//
// Worth testing off-device because the failure it prevents is only visible on
// one: a medication silently dropped from the group is a dose nobody is asked
// about, and that looks exactly like a medication that was never due.
//
// Run: ./gradlew testDebugUnitTest --tests "*.DosesAtInstantTest"
package com.reminderhealth.app.schedule

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class DosesAtInstantTest {

    private fun med(
        id: Long,
        times: List<String>,
        tz: String = "Asia/Kolkata",
        doseDays: List<Int>? = null,
        active: Boolean = true,
    ) = Medication(
        id = id,
        drugName = "Med$id",
        dosage = null,
        dosageAmount = 1.0,
        unitType = "TABLET",
        reminderTimes = times,
        doseDays = doseDays,
        timezone = tz,
        nextReminderAt = "2026-08-14T00:00:00Z",
        active = active,
        medicationReason = null,
    )

    // 12:00 Asia/Kolkata on Friday 14 Aug 2026 == 06:30 UTC.
    private val noonIst: Instant = Instant.parse("2026-08-14T06:30:00Z")

    @Test
    fun theFourMedicationScenario() {
        val meds = listOf(
            med(1, listOf("12:00")),
            med(2, listOf("12:00")),
            med(3, listOf("12:00")),
            med(4, listOf("12:00")),
            med(5, listOf("20:00")), // a different instant entirely
        )
        val group = DosesAtInstant.unanswered(meds, noonIst, emptySet())
        assertEquals(listOf(1L, 2L, 3L, 4L), group.map { it.id })
    }

    @Test
    fun answeredDosesLeaveTheGroup() {
        val meds = listOf(med(1, listOf("12:00")), med(2, listOf("12:00")), med(3, listOf("12:00")))
        // Answering is per dose; the rest stay outstanding and keep laddering.
        assertEquals(
            listOf(1L, 3L),
            DosesAtInstant.unanswered(meds, noonIst, setOf(2L)).map { it.id },
        )
        assertTrue(DosesAtInstant.unanswered(meds, noonIst, setOf(1L, 2L, 3L)).isEmpty())
    }

    /**
     * The wall clock is the MEDICATION's, not the phone's. A dose set for noon in
     * Kolkata is a noon dose while its owner is in London, and grouping on the
     * device's zone would split a handful across two screens the moment someone
     * travelled.
     */
    @Test
    fun timezoneIsTheMedicationsOwn() {
        val kolkata = med(1, listOf("12:00"), tz = "Asia/Kolkata")
        val london = med(2, listOf("12:00"), tz = "Europe/London")
        assertTrue(DosesAtInstant.hasDoseAt(kolkata, noonIst))
        // 06:30 UTC is 07:30 in London, not 12:00.
        assertFalse(DosesAtInstant.hasDoseAt(london, noonIst))
    }

    /** A minute apart is two asks, not one handful — matching the web rule. */
    @Test
    fun aMinuteApartIsNotTheSameHandful() {
        assertFalse(DosesAtInstant.hasDoseAt(med(1, listOf("12:01")), noonIst))
    }

    @Test
    fun doseDaysAreHonoured() {
        // 14 Aug 2026 is a Friday; 0=Sun..6=Sat, so Friday is 5.
        assertTrue(DosesAtInstant.hasDoseAt(med(1, listOf("12:00"), doseDays = listOf(5)), noonIst))
        assertFalse(DosesAtInstant.hasDoseAt(med(2, listOf("12:00"), doseDays = listOf(1, 4)), noonIst))
        // Null and empty both mean every day.
        assertTrue(DosesAtInstant.hasDoseAt(med(3, listOf("12:00"), doseDays = null), noonIst))
        assertTrue(DosesAtInstant.hasDoseAt(med(4, listOf("12:00"), doseDays = emptyList()), noonIst))
    }

    @Test
    fun pausedAndEmptyAreNeverDue() {
        assertFalse(DosesAtInstant.hasDoseAt(med(1, listOf("12:00"), active = false), noonIst))
        // Empty reminderTimes is a real state the bot pre-filters; it must not
        // throw here the way calculateNextReminder deliberately does.
        assertFalse(DosesAtInstant.hasDoseAt(med(2, emptyList()), noonIst))
    }

    /** A bad tz string must not drop the dose — it falls back, like the engines do. */
    @Test
    fun anUnknownTimezoneFallsBackRatherThanVanishing() {
        val broken = med(1, listOf("12:00"), tz = "Not/AZone")
        assertTrue(DosesAtInstant.hasDoseAt(broken, noonIst))
    }

    /** Legacy alias — live rows hold both spellings. */
    @Test
    fun timezoneAliasesResolve() {
        assertTrue(DosesAtInstant.hasDoseAt(med(1, listOf("12:00"), tz = "Asia/Calcutta"), noonIst))
    }

    /**
     * Order must not depend on input order: the screen must not reshuffle under
     * a thumb between one rung and the next.
     */
    @Test
    fun orderIsStable() {
        val a = listOf(med(3, listOf("12:00")), med(1, listOf("12:00")), med(2, listOf("12:00")))
        val b = listOf(med(2, listOf("12:00")), med(3, listOf("12:00")), med(1, listOf("12:00")))
        assertEquals(
            DosesAtInstant.unanswered(a, noonIst, emptySet()).map { it.id },
            DosesAtInstant.unanswered(b, noonIst, emptySet()).map { it.id },
        )
    }

    /** A medication with several times a day matches only the right one. */
    @Test
    fun onlyTheMatchingTimeOfADayCounts() {
        val twice = med(1, listOf("08:00", "12:00", "20:00"))
        assertTrue(DosesAtInstant.hasDoseAt(twice, noonIst))
        assertFalse(DosesAtInstant.hasDoseAt(twice, Instant.parse("2026-08-14T05:30:00Z"))) // 11:00 IST
    }
}
