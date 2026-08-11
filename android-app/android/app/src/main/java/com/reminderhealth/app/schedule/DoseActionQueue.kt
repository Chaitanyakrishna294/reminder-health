package com.reminderhealth.app.schedule

import android.content.Context
import android.util.Log
import java.time.Instant
import java.util.UUID

/**
 * The one place a dose answer becomes durable.
 *
 * There are now two ways a patient can answer a dose, and both must be equally
 * reliable: the full-screen [AlarmActivity] (locked / idle phone) and the
 * heads-up notification's Taken/Skip buttons (phone unlocked and in use — see
 * [DoseActionReceiver]). Extracting this means neither path can quietly grow a
 * different definition of "recorded".
 *
 * Ordering is the whole point: the action is written to the local queue BEFORE
 * any network is attempted, so it survives being offline, the process being
 * killed, and a reboot. A dose answer that only existed in an in-flight HTTP
 * request is data loss in a medication record.
 */
object DoseActionQueue {

    /**
     * Records [action] for a dose and kicks off delivery.
     *
     * Returns true once the action is DURABLY stored — not once it reaches the
     * server. Syncing is best-effort here on purpose: [ActionSync] fails
     * silently offline, and [ActionSyncWorker] is what actually guarantees
     * delivery later, when there is a network.
     *
     * @param scheduledFor the dose's own scheduled instant (ISO-8601 UTC), never
     *   "now" at tap time — it is how the server identifies WHICH dose this
     *   answers, via `resolve_reminder_event`'s (medication_id, scheduled_for).
     */
    suspend fun record(
        context: Context,
        medicationId: Long,
        drugName: String,
        scheduledFor: String?,
        action: String,
        snoozeMinutes: Int? = null,
    ): Boolean {
        if (medicationId <= 0L) {
            // Debug/test alarm — no medication row behind it, nothing to record.
            Log.i(AlarmScheduler.TAG, "dose action $action on test alarm; not queued")
            return false
        }
        if (scheduledFor == null) {
            // Without the dose's scheduled instant the server cannot identify
            // which dose this answers, so queuing it would be unresolvable.
            Log.e(AlarmScheduler.TAG, "dose action $action has no scheduledFor; cannot queue")
            return false
        }

        val entry = DoseAction(
            id = UUID.randomUUID().toString(),
            medicationId = medicationId,
            drugName = drugName,
            scheduledFor = scheduledFor,
            action = action,
            recordedAt = Instant.now().toString(),
            snoozeMinutes = snoozeMinutes,
        )

        val stored = runCatching {
            ScheduleDatabase.getInstance(context).doseActionDao().insert(entry)
        }
        if (stored.isFailure) {
            // Loud, because this is the failure that loses a patient's answer
            // outright — everything after this point is recoverable by retry.
            Log.e(
                AlarmScheduler.TAG,
                "FAILED to queue $action for med $medicationId ($drugName) — the answer is LOST",
                stored.exceptionOrNull(),
            )
            return false
        }

        Log.i(
            AlarmScheduler.TAG,
            "queued $action for med $medicationId ($drugName) scheduled $scheduledFor",
        )

        // Try now (succeeds instantly when online), and always ask for a
        // constrained retry as well — that is what delivers it after a reconnect.
        runCatching { ActionSync.flush(context) }
        runCatching { ActionSyncWorker.enqueue(context) }
        return true
    }
}
