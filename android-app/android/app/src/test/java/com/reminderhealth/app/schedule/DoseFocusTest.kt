// Local JVM unit test for the focused-list rotation.
//
// This is the part of the coalesced ring that fails INVISIBLY. A dose dropped
// from the rotation is a dose never asked about, and on the screen that looks
// identical to a dose that was never due — so the rules live in DoseFocus, off
// the Activity, where they can be asserted.
//
// Run: ./gradlew testDebugUnitTest --tests "*.DoseFocusTest"
package com.reminderhealth.app.schedule

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DoseFocusTest {

    private fun handful(vararg ids: Long) = DoseFocus().apply {
        setOrder(ids.toList())
        advance()
    }

    private val TAKEN = DoseAction.ACTION_TAKEN
    private val SKIP = DoseAction.ACTION_SKIP

    // -- THE 4-MED ACCEPTANCE SCENARIO ---------------------------------------

    @Test
    fun focusStartsAtTheFirstDose() {
        assertEquals(1L, handful(1, 2, 3, 4).focused)
    }

    @Test
    fun answeringAdvancesThroughTheWholeHandful() {
        val f = handful(1, 2, 3, 4)
        assertEquals(2L, f.answer(1, TAKEN))
        assertEquals(3L, f.answer(2, SKIP))
        assertEquals(4L, f.answer(3, TAKEN))
        assertNull("after the last dose there is nothing to focus", f.answer(4, TAKEN))
        assertTrue(f.isFinished())
        assertTrue(f.outstanding().isEmpty())
    }

    /**
     * A dose nobody answers must not hold the screen. Before yielding existed,
     * one unanswered dose meant the other three were never asked at all.
     */
    @Test
    fun aTimeoutYieldsToTheNextDose() {
        val f = handful(1, 2, 3, 4)
        assertEquals(2L, f.yieldFocus())
        assertEquals(3L, f.yieldFocus())
    }

    @Test
    fun aYieldedDoseIsStillOutstanding() {
        val f = handful(1, 2)
        f.yieldFocus()
        // Not resolved: its ladder keeps running and it belongs in the missed
        // notice. Yielding is about the SCREEN's attention, nothing else.
        assertTrue(1L in f.outstanding())
        assertFalse(f.answered.containsKey(1L))
    }

    @Test
    fun theScreenEndsOnceEveryDoseHasHadItsTurn() {
        val f = handful(1, 2)
        f.yieldFocus()
        assertNull(f.yieldFocus())
        assertTrue(f.isFinished())
        // ...but both are still unanswered, which is what the missed notice is for.
        assertEquals(listOf(1L, 2L), f.outstanding())
    }

    @Test
    fun answeringAndTimingOutMix() {
        val f = handful(1, 2, 3, 4)
        assertEquals(2L, f.answer(1, TAKEN))
        assertEquals(3L, f.yieldFocus())
        assertEquals(4L, f.answer(3, SKIP))
        assertNull(f.yieldFocus())
        assertEquals(listOf(2L, 4L), f.outstanding())
        assertEquals(TAKEN, f.answered[1L])
        assertEquals(SKIP, f.answered[3L])
    }

    // -- TAP TO JUMP ---------------------------------------------------------

    @Test
    fun anyDoseCanBeTappedIntoFocus() {
        val f = handful(1, 2, 3, 4)
        assertEquals(4L, f.focusOn(4))
        assertEquals(1L, f.answer(4, TAKEN)) // then back to the first unasked
    }

    /** Tapping a dose whose window expired gives it a FRESH window, not a dead one. */
    @Test
    fun tappingAYieldedDoseRevivesIt() {
        val f = handful(1, 2)
        f.yieldFocus()
        assertEquals(1L, f.focusOn(1))
        assertFalse(1L in f.yielded)
    }

    @Test
    fun anAnsweredDoseCannotBeTappedBack() {
        val f = handful(1, 2)
        f.answer(1, TAKEN)
        // Correcting the past needs judgement about the past — that is the
        // caregiver's job from a history surface, never a 3am alarm screen.
        assertEquals(2L, f.focusOn(1))
    }

    // -- ITEM 7: A RUNG ARRIVING MID-PRESENTATION -----------------------------
    //
    // A ladder rung can fire while the screen is still working through a handful
    // (a 1-minute ladder against a 4-dose screen makes this ordinary, not exotic).
    // The re-presentation must carry only the STILL-UNANSWERED subset. The
    // grouping is derived from the schedule, so DosesAtInstant hands back exactly
    // that set — these assert the focus state does not undo it.

    @Test
    fun aRungRepresentsOnlyTheUnansweredSubset() {
        val f = handful(1, 2, 3, 4)
        f.answer(1, TAKEN)
        f.answer(2, SKIP)

        // The rung's refresh: DosesAtInstant.rowsAt returns unanswered doses only.
        f.setOrder(listOf(3L, 4L))

        assertEquals(listOf(3L, 4L), f.outstanding())
        assertEquals(TAKEN, f.answered[1L])
        assertEquals(SKIP, f.answered[2L])
    }

    @Test
    fun aRungDoesNotResurrectAnAnsweredDose() {
        val f = handful(1, 2)
        f.answer(1, TAKEN)
        // Even if a stale read hands 1 back — the sync raced the queue write —
        // the screen must not ask about it again. The local record wins, because
        // the patient made it and it is already durable.
        f.setOrder(listOf(1L, 2L))
        f.advance()
        assertEquals(2L, f.focused)
        assertEquals(listOf(2L), f.outstanding())
    }

    @Test
    fun aRungKeepsYieldedDosesYielded() {
        val f = handful(1, 2, 3)
        f.yieldFocus() // 1 yields, focus -> 2
        f.setOrder(listOf(1L, 2L, 3L))
        // Re-presenting must not silently give dose 1 another automatic turn, or
        // a short ladder against a long handful would loop the same dose forever.
        assertTrue(1L in f.yielded)
        assertEquals(2L, f.focused)
    }

    @Test
    fun aDoseDeletedFromTheStoreLeavesTheRotation() {
        val f = handful(1, 2, 3)
        f.setOrder(listOf(2L, 3L)) // med 1 deleted mid-alarm
        f.advance()
        assertEquals(2L, f.focused)
        assertFalse(1L in f.outstanding())
    }

    // -- ANSWERED ELSEWHERE ---------------------------------------------------

    @Test
    fun answeringOnTheNotificationClearsTheFocusedDose() {
        val f = handful(1, 2)
        f.answeredElsewhere(1)
        assertNull("the focused dose was answered elsewhere; nothing is focused", f.focused)
        assertEquals(2L, f.advance())
    }

    @Test
    fun anOutcomeAnsweredElsewhereIsUnknownNotAssumedTaken() {
        val f = handful(1)
        f.answeredElsewhere(1)
        assertTrue(f.answered.containsKey(1L))
        assertNull("null means recorded, outcome unseen — never guess Taken", f.answered[1L])
    }

    // -- DEGENERATE -----------------------------------------------------------

    @Test
    fun oneDoseBehavesExactlyAsBefore() {
        val f = handful(7)
        assertEquals(7L, f.focused)
        assertNull(f.answer(7, TAKEN))
        assertTrue(f.isFinished())
    }

    @Test
    fun anEmptyHandfulIsFinishedImmediately() {
        val f = DoseFocus()
        f.setOrder(emptyList())
        assertNull(f.advance())
        assertTrue(f.isFinished())
    }
}
