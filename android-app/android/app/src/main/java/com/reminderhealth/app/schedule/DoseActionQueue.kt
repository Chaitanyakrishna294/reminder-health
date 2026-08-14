package com.reminderhealth.app.schedule

import android.content.Context
import android.content.Intent
import android.util.Log
import java.time.Instant
import java.util.UUID

/**
 * The one place a dose answer becomes durable — and the one place a retry ladder
 * dies.
 *
 * There are now FOUR ways a dose can be answered, and every one of them has to
 * be equally reliable and have exactly the same side effects:
 *
 *  1. the full-screen [AlarmActivity] (locked / idle phone);
 *  2. the heads-up notification's Taken/Skip buttons ([DoseActionReceiver]);
 *  3. the webview — the Today rail, the dose gate, elderly mode — which resolves
 *    straight to Supabase and tells the device afterwards
 *    ([ScheduleBridgePlugin.doseResolved]);
 *  4. a caregiver answering remotely, which reaches the device the next time the
 *    webview reconciles (same bridge call).
 *
 * Paths 3 and 4 were the 2026-08-14 bug: they resolved the dose on the server
 * and the device never heard, so `pending_retries` kept firing every five
 * minutes at a patient who had already answered in the app. Two critical
 * medications, marked skipped, still ringing. Routing every path through this
 * one function is the fix — not a second cancellation call bolted onto the
 * webview, which is exactly the kind of thing that drifts.
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
     * @param alreadyOnServer the answer was made ON the server and is being
     *   mirrored here (paths 3 and 4 above). The row is written `synced = true`
     *   so it counts as an answer everywhere the device asks — the coalesced
     *   alarm screen, the notification group, the ladder — while [ActionSync]
     *   correctly never tries to send it back.
     */
    suspend fun record(
        context: Context,
        medicationId: Long,
        drugName: String,
        scheduledFor: String?,
        action: String,
        snoozeMinutes: Int? = null,
        /**
         * SNOOZE only: when the device will re-ask. Persisted alongside the dose
         * instant so the re-prompt survives a reboot — see [PendingSnooze].
         */
        snoozeFireAt: Instant? = null,
        alreadyOnServer: Boolean = false,
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
            synced = alreadyOnServer,
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
            "queued $action for med $medicationId ($drugName) scheduled $scheduledFor" +
                if (alreadyOnServer) " (already resolved on the server; mirrored locally)" else "",
        )

        // Snooze bookkeeping, so a reboot cannot lose the re-prompt and so an
        // answered dose stops re-prompting. Best-effort: this is a convenience
        // over the alarm that is already registered, never the record of the
        // patient's answer — that is the queue row written above.
        runCatching {
            val snoozeDao = ScheduleDatabase.getInstance(context).pendingSnoozeDao()
            if (action == DoseAction.ACTION_SNOOZE && snoozeFireAt != null) {
                snoozeDao.upsert(
                    PendingSnooze(
                        medicationId = medicationId,
                        doseAt = scheduledFor,
                        fireAt = snoozeFireAt.toString(),
                    ),
                )
            } else {
                // Taken/Skip: the dose is answered, so any outstanding snooze for
                // it is void. Without this a re-sync or reboot would resurrect a
                // re-prompt for a dose the patient already dealt with.
                snoozeDao.clear(medicationId)
            }

            /*
             * THE RETRY LADDER STOPS THE INSTANT THE DOSE IS ANSWERED, whichever
             * surface answered it — the full-screen alarm, the notification
             * buttons, the app's own rail or gate, or a caregiver on the web
             * whose answer arrives here as a reconciliation. This is the one
             * choke point every answer the device learns about passes through,
             * which is why the cancellation lives here rather than in the several
             * UI files that would drift.
             *
             * A SNOOZE SUSPENDS the ladder rather than ending it: the patient
             * asked for quiet time, not to be counted as having answered. The
             * snooze re-fire finds no ladder and starts a fresh one, so the
             * re-asking resumes from the re-prompt instead of racing it.
             *
             * cancelLadder also restores the next-dose alarm, which is not
             * optional: a live rung occupies this medication's single alarm slot.
             */
            AlarmScheduler.cancelLadder(context, medicationId)
        }.onFailure {
            Log.w(AlarmScheduler.TAG, "pending-snooze bookkeeping failed for med $medicationId", it)
        }

        // The notification asks about the whole handful, so answering one dose
        // narrows it rather than clearing it; the last answer is what clears it.
        // A snooze takes the notification away outright — that is what "not now"
        // means, and the re-fire posts a fresh one.
        runCatching {
            if (action == DoseAction.ACTION_SNOOZE) {
                DoseNotifications.cancelGroup(context, scheduledFor, medicationId)
            } else {
                DoseNotifications.refreshGroup(context, scheduledFor)
            }
        }.onFailure {
            Log.w(AlarmScheduler.TAG, "could not update the notification for the dose due $scheduledFor", it)
        }

        // Tell a visible alarm screen. It re-reads the store rather than trusting
        // this signal, so the broadcast only has to say "something changed at
        // this instant" — which is all any of the four answer paths can honestly
        // claim about the others.
        runCatching {
            context.sendBroadcast(
                Intent(DoseActionReceiver.ACTION_ANSWERED)
                    .setPackage(context.packageName)
                    .putExtra(AlarmScheduler.EXTRA_MEDICATION_ID, medicationId)
                    .putExtra(AlarmScheduler.EXTRA_SCHEDULED_FOR, scheduledFor),
            )
        }

        // Nothing to send for an answer that came FROM the server.
        if (alreadyOnServer) return true

        // Try now (succeeds instantly when online), and always ask for a
        // constrained retry as well — that is what delivers it after a reconnect.
        runCatching { ActionSync.flush(context) }
        runCatching { ActionSyncWorker.enqueue(context) }
        return true
    }
}
