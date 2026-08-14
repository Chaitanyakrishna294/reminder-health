package com.reminderhealth.app.schedule

/**
 * THE RETRY LADDER — how many times the device re-asks before it gives up and
 * leaves the sticky missed notice.
 *
 * Between the first ring and the caregiver being told, the honest thing to do is
 * simply ask again: someone put the phone down, or was in the shower, or meant
 * to and forgot in the ninety seconds since.
 *
 * **This is the arithmetic only.** It computes minute OFFSETS from the dose's
 * scheduled time and schedules nothing — fire times come from [AlarmScheduler],
 * per the one-clock doctrine. It is a direct port of
 * `web/src/lib/schedule/retry-ladder.ts`, and both are held to
 * `test/retry-ladder-vectors.json` by their own tests. Add cases to the FIXTURE,
 * never here: the two `calculateNextReminder` copies drifted precisely because
 * each side had its own hand-written tests.
 *
 * **THE 30-MINUTE CAP IS THE WHOLE SAFETY ARGUMENT.**
 * `scan_and_escalate_overdue_reminders` clamps its escalation anchor to
 * `created_at + 30 minutes`, and that clamp exists so a dose nobody re-prompted
 * still escalates. If a ladder could run past it, the patient would be politely
 * re-asked at +35 while their daughter was already being told they had missed it
 * — the app contradicting itself across two phones. Do not raise this here
 * alone; it is enforced by a database CHECK and by the edit form too.
 */
object RetryLadder {

    /** Hard ceiling on `interval * count`, in minutes. Load-bearing, not a preference. */
    const val CAP_MINUTES = 30

    data class Config(val interval: Int, val count: Int)

    /**
     * Defaults per priority. Routine gets ONE nudge because a missed vitamin is
     * not an event; critical gets five because that is the case the whole
     * feature exists for, and 5 x 5 = 25 leaves headroom under the cap.
     */
    private val DEFAULTS = mapOf(
        "normal" to Config(15, 1),
        "important" to Config(10, 2),
        "critical" to Config(5, 5),
    )

    /** Unknown or missing priority falls to `normal`, matching `priorityMeta`. */
    fun normalisePriority(level: String?): String {
        val key = (level ?: "").lowercase()
        return if (key == "critical" || key == "important") key else "normal"
    }

    /**
     * Which priorities expose the controls. Routine is deliberately fixed:
     * offering a supplement its own retry schedule is a setting nobody needs.
     */
    fun isConfigurable(level: String?): Boolean = normalisePriority(level) != "normal"

    /** Why this pair is not allowed, or null when it is. */
    fun validationError(interval: Int?, count: Int?): String? {
        if (interval == null || count == null) return "Use both a gap and a number of reminders."
        if (interval < 1 || count < 1) return "Use at least 1 minute and 1 reminder."
        if (interval * count > CAP_MINUTES) {
            return "That comes to ${interval * count} minutes. Reminders can carry on for up to $CAP_MINUTES minutes after the dose is due."
        }
        return null
    }

    /**
     * Minute offsets from the dose's scheduled time at which the device re-asks.
     *
     * `[5, 10, 15, 20, 25]` for a default critical medication.
     *
     * Stored config that violates the cap is IGNORED in favour of the priority
     * default, not clamped. A row can only get out of range through a direct
     * database write or a future cap change, and silently shortening someone's
     * critical ladder to fit is a worse failure than falling back to a
     * known-good one.
     */
    fun offsets(priority: String?, interval: Int?, count: Int?): List<Int> {
        val fallback = DEFAULTS[normalisePriority(priority)]!!
        val chosenInterval = interval ?: fallback.interval
        val chosenCount = count ?: fallback.count
        val chosen =
            if (validationError(chosenInterval, chosenCount) == null) {
                Config(chosenInterval, chosenCount)
            } else {
                fallback
            }
        return (1..chosen.count).map { it * chosen.interval }
    }

    /** Convenience for a stored row. */
    fun offsetsFor(medication: Medication): List<Int> =
        offsets(medication.priorityLevel, medication.retryLadderIntervalMinutes, medication.retryLadderCount)

    /**
     * How long the device keeps asking, in minutes from the scheduled time —
     * the window the server's escalation must not pre-empt. The LAST offset,
     * not the cap: a two-rung ladder is done at 20 and there is no reason to
     * make its caregiver wait until 30.
     */
    fun windowMinutes(priority: String?, interval: Int?, count: Int?): Int =
        offsets(priority, interval, count).lastOrNull() ?: 0

    /**
     * Rungs still to come after the dose is answered at [resolvedAtMinute] —
     * exactly the alarms to cancel. Resolving cancels the chain from ANY
     * surface: the notification action, the app, or a caregiver on the web.
     *
     * An offline device keeps climbing until it learns, which is correct: it has
     * no reason to believe the dose was taken.
     */
    fun remaining(offsets: List<Int>, resolvedAtMinute: Int): List<Int> =
        offsets.filter { it > resolvedAtMinute }
}
