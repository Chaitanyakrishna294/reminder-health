# draft-m2/ — M2 groundwork, not wired into any build

Everything here is **DRAFT and unverified** — this machine has no JDK/Android SDK, so nothing in
this directory has ever compiled or run. It's deliberately outside `android/app/src/` (every
Gradle source set Capacitor's default template scans), so a `cap sync` or Gradle build today
can't pick it up by accident.

- `CalculateNextReminder.kt` — draft Kotlin port of `calculateNextReminder`
  (`src/utils.js` / `web/src/lib/medication-utils.ts`), ported from the algorithm spec + the
  shared fixture, not by transcribing the JS. Eventual home:
  `android/app/src/main/java/com/reminderhealth/app/schedule/CalculateNextReminder.kt`.
- `CalculateNextReminderTest.kt` — draft JUnit test consuming the same
  `test/schedule-test-vectors.json` fixture the bot and web tests already pass. Eventual home:
  `android/app/src/test/java/com/reminderhealth/app/schedule/CalculateNextReminderTest.kt`.

**Before moving these into the real source tree:** get a JDK + Android SDK working, move both
files to their eventual homes above, add `testImplementation("org.json:json:...")` to
`android/app/build.gradle` (see the test file's header for why), run
`./gradlew testDebugUnitTest --tests "*.CalculateNextReminderTest"`, and fix whatever the
compiler/test runner finds — treat this code as a first draft, not a finished port.

See `android-app/BRIDGE_CONTRACT.md` for the webview↔native bridge these will eventually sit
behind (`syncSchedule`), and `CLAUDE.md`'s Android section for the full M2 scope.
