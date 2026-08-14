package com.reminderhealth.app.schedule

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Handles **Taken / Skip / Snooze tapped on the notification itself**, without
 * opening anything.
 *
 * Why this exists: when the phone is unlocked and in active use, Android
 * deliberately suppresses the full-screen intent and shows the dose alarm as a
 * heads-up notification instead (see CLAUDE.md — this is correct behaviour and
 * must not be overridden). Someone already looking at their phone should be able
 * to answer the dose right there; making them tap through to a full-screen
 * takeover for a dose they are clearly awake for is worse, not safer.
 *
 * A BroadcastReceiver rather than an Activity on purpose: the point is to answer
 * WITHOUT a screen appearing. It is also pure native, so this path works with no
 * network and without the webview ever starting.
 *
 * **Group actions.** A notification has three action slots and a handful can
 * have four doses, so a coalesced notification carries "Taken all" and "Snooze"
 * (both meaningful for a whole handful) plus "Open" for answering them
 * individually. [EXTRA_APPLY_TO_GROUP] is what distinguishes the two, and the
 * group case simply resolves the same per-dose path once per dose — there is no
 * second implementation of what answering means.
 */
class DoseActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = when (intent.action) {
            ACTION_TAKEN -> DoseAction.ACTION_TAKEN
            ACTION_SKIP -> DoseAction.ACTION_SKIP
            ACTION_SNOOZE -> DoseAction.ACTION_SNOOZE
            else -> {
                Log.w(AlarmScheduler.TAG, "DoseActionReceiver got unexpected action ${intent.action}; ignoring")
                return
            }
        }

        val scheduledFor = intent.getStringExtra(AlarmScheduler.EXTRA_SCHEDULED_FOR)
        val applyToGroup = intent.getBooleanExtra(EXTRA_APPLY_TO_GROUP, false)
        val single = DoseRow(
            medicationId = intent.getLongExtra(AlarmScheduler.EXTRA_MEDICATION_ID, -1L),
            drugName = intent.getStringExtra(AlarmScheduler.EXTRA_DRUG_NAME) ?: "your medication",
            doseLabel = intent.getStringExtra(AlarmScheduler.EXTRA_DOSE_LABEL),
            audioPath = intent.getStringExtra(AlarmScheduler.EXTRA_AUDIO_PATH),
            photoPath = intent.getStringExtra(AlarmScheduler.EXTRA_PHOTO_PATH),
        )

        Log.i(
            AlarmScheduler.TAG,
            "notification action $action tapped for " +
                (if (applyToGroup) "every dose" else "med ${single.medicationId} (${single.drugName})") +
                " due $scheduledFor",
        )

        // goAsync: a BroadcastReceiver is killable the moment onReceive returns,
        // and the Room write must not be racing that.
        val pending = goAsync()
        val appContext = context.applicationContext
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val rows = if (applyToGroup) {
                    DosesAtInstant.rowsAt(appContext, scheduledFor)
                } else {
                    listOf(single)
                }

                rows.forEach { row -> apply(appContext, row, scheduledFor, action) }
            } finally {
                pending.finish()
            }
        }
    }

    /**
     * One dose, one answer. Everything that makes an answer real — the queue
     * write, the ladder cancellation, the notification update, telling a visible
     * alarm screen — happens inside [DoseActionQueue.record], so this function
     * only has to handle the half of a snooze the queue cannot: putting a real
     * alarm back on the device.
     */
    private suspend fun apply(context: Context, row: DoseRow, scheduledFor: String?, action: String) {
        // Snooze must do BOTH halves, exactly as the alarm screen does:
        // re-register this device's alarm so the patient is actually asked again,
        // AND queue a server-side snooze so reminder_events.retry_reminder_at moves
        // and the care circle is not told the dose was missed. A device-only snooze
        // produces a false escalation alert — the whole reason
        // snooze_reminder_event exists.
        var snoozeFireAt: Instant? = null
        if (action == DoseAction.ACTION_SNOOZE && row.medicationId > 0L) {
            val fireAt = Instant.now().plusSeconds(AlarmActivity.SNOOZE_MINUTES * 60L)
            snoozeFireAt = fireAt
            // Carry the ORIGINAL dose instant into the re-fire, not the snooze
            // time — see AlarmScheduler.scheduleAt's `scheduledFor` doc.
            val doseInstant = scheduledFor?.let { runCatching { Instant.parse(it) }.getOrNull() }
            AlarmScheduler.scheduleAt(
                context = context,
                medicationId = row.medicationId,
                drugName = row.drugName,
                doseLabel = row.doseLabel,
                fireAt = fireAt,
                audioPath = row.audioPath,
                photoPath = row.photoPath,
                scheduledFor = doseInstant ?: fireAt,
            )
            Log.i(
                AlarmScheduler.TAG,
                "snoozed med ${row.medicationId} by ${AlarmActivity.SNOOZE_MINUTES} min from the notification",
            )
        }

        DoseActionQueue.record(
            context = context,
            medicationId = row.medicationId,
            drugName = row.drugName,
            scheduledFor = scheduledFor,
            action = action,
            snoozeMinutes = if (action == DoseAction.ACTION_SNOOZE) AlarmActivity.SNOOZE_MINUTES else null,
            snoozeFireAt = snoozeFireAt,
        )
    }

    companion object {
        const val ACTION_TAKEN = "com.reminderhealth.app.action.DOSE_TAKEN"
        const val ACTION_SKIP = "com.reminderhealth.app.action.DOSE_SKIP"
        const val ACTION_SNOOZE = "com.reminderhealth.app.action.DOSE_SNOOZE"

        /** True when this button answers every dose still waiting at its instant. */
        const val EXTRA_APPLY_TO_GROUP = "applyToGroup"

        /**
         * Internal, in-process only (`setPackage` + a non-exported receiver
         * registration): tells a visible [AlarmActivity] that a dose at this
         * instant was just answered somewhere else, so it should re-read the
         * group. Broadcast from [DoseActionQueue.record], so it fires for every
         * answer path rather than only this one.
         */
        const val ACTION_ANSWERED = "com.reminderhealth.app.action.DOSE_ANSWERED"
    }
}
