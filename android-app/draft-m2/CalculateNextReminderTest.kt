// DRAFT — UNVERIFIED. Cannot compile or run on this machine (no JDK/Android
// SDK installed as of 2026-08-10). Written to consume the SAME fixture the
// bot (test/utils.test.js) and web (web/src/lib/medication-utils.test.ts)
// tests already pass — do not hand-write separate Kotlin test cases here;
// add new cases to test/schedule-test-vectors.json instead, same rule the
// other two follow.
//
// Eventual real location once wired in:
//   android-app/android/app/src/test/java/com/reminderhealth/app/schedule/CalculateNextReminderTest.kt
// (a local JVM unit test, next to CalculateNextReminder.kt's src/main
// counterpart). Deliberately NOT there yet — see CalculateNextReminder.kt's
// header for why.
//
// Two things to verify once this is actually wired in and the SDK exists:
//   1. Requires `testImplementation("org.json:json:20240303")` (or whatever
//      is current) in android/app/build.gradle — Android's BUNDLED org.json
//      classes are stubbed out for local (non-instrumented) JVM unit tests
//      and throw at runtime; the standalone org.json:json Maven artifact is
//      the standard workaround.
//   2. FIXTURE_PATH below assumes the Gradle `Test` task's working directory
//      is the app module root (android/app/) — Gradle's default, but
//      confirm rather than assume once this actually runs.
package com.reminderhealth.app.schedule

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.File
import java.time.Instant

class CalculateNextReminderTest {

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
