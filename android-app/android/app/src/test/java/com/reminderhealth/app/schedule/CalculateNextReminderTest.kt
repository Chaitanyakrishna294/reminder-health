// Local JVM unit test (runs on your dev machine, not a device/emulator).
// Consumes the SAME fixture the bot (test/utils.test.js) and web
// (web/src/lib/medication-utils.test.ts) engines already pass — do not
// hand-write separate Kotlin test cases here; add new cases to
// test/schedule-test-vectors.json instead, same rule the other two follow.
//
// Run: ./gradlew testDebugUnitTest --tests "*.CalculateNextReminderTest"
// or right-click this file in Android Studio -> Run.
package com.reminderhealth.app.schedule

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.File
import java.time.Instant

class CalculateNextReminderTest {

    // Gradle's Test task working directory defaults to the module root
    // (android/app/), three levels below the repo root.
    private val fixturePath = "../../../test/schedule-test-vectors.json"

    @Test
    fun runsEveryFixtureVector() {
        val fixtureFile = File(fixturePath)
        check(fixtureFile.exists()) {
            "Fixture not found at $fixturePath (resolved: ${fixtureFile.absolutePath}) — " +
                "if the Gradle test working directory isn't android/app/, fix the relative path above."
        }

        val root = JSONObject(fixtureFile.readText())
        val vectors = root.getJSONArray("vectors")

        for (i in 0 until vectors.length()) {
            val v = vectors.getJSONObject(i)
            val name = v.getString("name")

            val reminderTimesJson = v.getJSONArray("reminderTimes")
            val reminderTimes = (0 until reminderTimesJson.length()).map { reminderTimesJson.getString(it) }

            val timezone = if (v.isNull("timezone")) null else v.getString("timezone")

            val doseDays = if (v.isNull("doseDays")) {
                null
            } else {
                val arr = v.getJSONArray("doseDays")
                (0 until arr.length()).map { arr.getInt(it) }
            }

            val now = Instant.parse(v.getString("now"))

            if (v.optBoolean("expectThrow", false)) {
                assertThrows(
                    "vector \"$name\" should throw EmptyReminderTimesException",
                    EmptyReminderTimesException::class.java,
                ) {
                    calculateNextReminder(reminderTimes, timezone, doseDays, now)
                }
            } else {
                val expected = Instant.parse(v.getString("expectedUtc"))
                val actual = calculateNextReminder(reminderTimes, timezone, doseDays, now)
                assertEquals("vector \"$name\"", expected, actual)
            }
        }
    }
}
