package com.reminderhealth.app.schedule

import java.time.Instant
import java.time.ZoneId

/**
 * WHICH MEDICATIONS ARE DUE AT ONE INSTANT — the coalescing question.
 *
 * A person takes their noon medicines as one handful, so the alarm screen has to
 * present them as one handful. Four medications at 12:00 previously produced four
 * independent alarms, and on a real device two of them fought for the full screen
 * while the other two sat as notifications nobody opened.
 *
 * Ladders stay INDEPENDENT in the scheduler — that is deliberate and unchanged.
 * Only the presentation coalesces, and this is what it coalesces on.
 *
 * DERIVED FROM THE SCHEDULE, NOT FROM ALARM STATE. The alternative was to ask
 * which alarms happen to be pending, which is unreliable exactly when it matters:
 * an original ring and a rung race each other, and after a reboot there are no
 * pending alarms at all until `rescheduleAll` has run. A medication's own
 * reminder times and dose days are the same facts that scheduled the alarm in
 * the first place, so asking them again gives the same answer no matter which
 * firing arrives first or whether the phone has just restarted.
 *
 * "Answered" means a queued [DoseAction] for that exact `(medicationId,
 * scheduledFor)` pair. The queue is written before anything is synced, so a dose
 * answered offline drops out of the group immediately — which is the behaviour
 * someone standing there tapping expects.
 */
object DosesAtInstant {

    /**
     * Does this medication have a dose at exactly [instant]?
     *
     * Compares the instant's wall-clock time IN THE MEDICATION'S OWN TIMEZONE
     * against its reminder times, then checks the weekday against its dose days.
     * Timezone matters here for the same reason it matters everywhere else in
     * this app: an 08:00 dose is a morning dose even when the phone is in London.
     */
    fun hasDoseAt(medication: Medication, instant: Instant): Boolean {
        if (!medication.active) return false
        if (medication.reminderTimes.isEmpty()) return false

        val zone = runCatching {
            ZoneId.of(medication.timezone.ifBlank { DEFAULT_TIMEZONE })
        }.getOrElse { ZoneId.of(DEFAULT_TIMEZONE) }

        val local = instant.atZone(zone)
        val hhmm = String.format("%02d:%02d", local.hour, local.minute)
        if (medication.reminderTimes.none { it.trim() == hhmm }) return false

        val days = medication.doseDays
        if (days.isNullOrEmpty()) return true
        // 0=Sunday..6=Saturday, matching medications.dose_days and both JS
        // engines — NOT java.time's Monday=1..Sunday=7.
        val dow = local.dayOfWeek.value % 7
        return days.contains(dow)
    }

    /**
     * Every medication due at [instant] that has NOT been answered.
     *
     * Sorted by medication id purely so the order is stable: the screen must not
     * reshuffle under someone's thumb between one rung and the next, and id is
     * the only ordering every surface can agree on without extra state.
     *
     * @param answeredIds medication ids already answered for THIS instant.
     */
    fun unanswered(
        medications: List<Medication>,
        instant: Instant,
        answeredIds: Set<Long>,
    ): List<Medication> =
        medications
            .filter { hasDoseAt(it, instant) && it.id !in answeredIds }
            .sortedBy { it.id }

    /**
     * Read the store and work out who is still waiting at [instant].
     *
     * The DoseAction queue is the answered-set: rows are written the moment a
     * patient taps, before any sync, so this is correct offline.
     */
    suspend fun unansweredFromStore(
        db: ScheduleDatabase,
        instant: Instant,
    ): List<Medication> {
        val answered = runCatching { db.doseActionDao().answeredMedicationIdsAt(instant.toString()) }
            .getOrDefault(emptyList())
            .toSet()
        return unanswered(db.medicationDao().getAll(), instant, answered)
    }
}
