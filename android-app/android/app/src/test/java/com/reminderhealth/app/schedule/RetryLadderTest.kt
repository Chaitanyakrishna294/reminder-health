// Local JVM unit test (runs on your dev machine, not a device/emulator).
// Consumes the SAME fixture the web engine passes
// (web/src/lib/schedule/retry-ladder.test.ts) — do not hand-write separate
// Kotlin cases here; add them to test/retry-ladder-vectors.json instead, the
// same rule CalculateNextReminderTest follows.
//
// The two calculateNextReminder copies drifted precisely because each side had
// its own tests. A retry ladder that disagreed between the settings form and the
// phone would be worse: the form would promise a rhythm the device never rings.
//
// Run: ./gradlew testDebugUnitTest --tests "*.RetryLadderTest"
package com.reminderhealth.app.schedule

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class RetryLadderTest {

    // Gradle's Test task working directory defaults to the module root
    // (android/app/), three levels below the repo root — same as
    // CalculateNextReminderTest.
    private val fixturePath = "../../../test/retry-ladder-vectors.json"

    private fun ints(a: JSONArray): List<Int> = (0 until a.length()).map { a.getInt(it) }

    private fun root(): JSONObject {
        val f = File(fixturePath)
        check(f.exists()) {
            "Fixture not found at $fixturePath (resolved: ${f.absolutePath}) — " +
                "if the Gradle test working directory isn't android/app/, fix the relative path above."
        }
        return JSONObject(f.readText())
    }

    /** The cap is stated in both the fixture and the code; a change to one must fail here. */
    @Test
    fun capMatchesTheFixture() {
        assertEquals(root().getInt("capMinutes"), RetryLadder.CAP_MINUTES)
    }

    @Test
    fun everyLadderVector() {
        val r = root()
        var checked = 0

        for (section in listOf("defaults", "custom")) {
            val arr = r.getJSONArray(section)
            for (i in 0 until arr.length()) {
                val v = arr.getJSONObject(i)
                val name = v.getString("name")
                val priority = if (v.isNull("priority")) null else v.getString("priority")

                var interval: Int? = null
                var count: Int? = null
                if (!v.isNull("config")) {
                    val c = v.getJSONObject("config")
                    // A fractional interval must reach the same fallback the web
                    // takes — Kotlin has no Number type that would accept 7.5 as
                    // an Int, so read it as a Double and reject non-integers the
                    // way `Number.isInteger` does.
                    if (c.has("interval")) {
                        val d = c.getDouble("interval")
                        interval = if (d == Math.floor(d)) d.toInt() else Int.MIN_VALUE
                    }
                    if (c.has("count")) {
                        val d = c.getDouble("count")
                        count = if (d == Math.floor(d)) d.toInt() else Int.MIN_VALUE
                    }
                }

                assertEquals(name, ints(v.getJSONArray("expectedOffsets")), RetryLadder.offsets(priority, interval, count))
                assertEquals("window: $name", v.getInt("expectedWindow"), RetryLadder.windowMinutes(priority, interval, count))
                checked += 2
            }
        }

        val validation = r.getJSONArray("validation")
        for (i in 0 until validation.length()) {
            val v = validation.getJSONObject(i)
            val name = v.getString("name")
            val iv = v.getDouble("interval")
            val ct = v.getDouble("count")
            // Same non-integer handling as above.
            val interval = if (iv == Math.floor(iv)) iv.toInt() else Int.MIN_VALUE
            val count = if (ct == Math.floor(ct)) ct.toInt() else Int.MIN_VALUE
            val err = RetryLadder.validationError(interval, count)
            assertEquals(name, v.getBoolean("valid"), err == null)
            if (!v.getBoolean("valid")) {
                assertTrue("no message for: $name", (err ?: "").isNotEmpty())
            }
            checked++
        }

        val cancellation = r.getJSONArray("cancellation")
        for (i in 0 until cancellation.length()) {
            val v = cancellation.getJSONObject(i)
            assertEquals(
                v.getString("name"),
                ints(v.getJSONArray("expectedCancelled")),
                RetryLadder.remaining(ints(v.getJSONArray("offsets")), v.getInt("resolvedAtMinute")),
            )
            checked++
        }

        println("RetryLadderTest: $checked fixture assertions passed")
    }

    /** No ladder may ever reach the escalation clamp, whatever the config says. */
    @Test
    fun noLadderOutrunsTheCap() {
        val r = root()
        for (section in listOf("defaults", "custom")) {
            val arr = r.getJSONArray(section)
            for (i in 0 until arr.length()) {
                val v = arr.getJSONObject(i)
                assertTrue(
                    "window exceeds the cap: ${v.getString("name")}",
                    v.getInt("expectedWindow") <= RetryLadder.CAP_MINUTES,
                )
            }
        }
    }

    /** Routine is deliberately fixed; the two that matter are configurable. */
    @Test
    fun onlyImportantAndCriticalAreConfigurable() {
        assertEquals(false, RetryLadder.isConfigurable("normal"))
        assertEquals(false, RetryLadder.isConfigurable(null))
        assertEquals(true, RetryLadder.isConfigurable("important"))
        assertEquals(true, RetryLadder.isConfigurable("critical"))
    }
}
