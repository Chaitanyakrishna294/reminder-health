package com.reminderhealth.app.schedule

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Handles **Taken / Skip tapped on the notification itself**, without opening
 * anything.
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

        val medicationId = intent.getLongExtra(AlarmScheduler.EXTRA_MEDICATION_ID, -1L)
        val drugName = intent.getStringExtra(AlarmScheduler.EXTRA_DRUG_NAME) ?: "your medication"
        val doseLabel = intent.getStringExtra(AlarmScheduler.EXTRA_DOSE_LABEL)
        val scheduledFor = intent.getStringExtra(AlarmScheduler.EXTRA_SCHEDULED_FOR)
        val audioPath = intent.getStringExtra(AlarmScheduler.EXTRA_AUDIO_PATH)
        val photoPath = intent.getStringExtra(AlarmScheduler.EXTRA_PHOTO_PATH)

        Log.i(
            AlarmScheduler.TAG,
            "notification action $action tapped for med $medicationId ($drugName) scheduled $scheduledFor",
        )

        // Snooze must do BOTH halves, exactly as AlarmActivity.snooze() does:
        // re-register this device's alarm so the patient is actually asked again,
        // AND queue a server-side snooze so reminder_events.retry_reminder_at moves
        // and the care circle is not told the dose was missed. A device-only snooze
        // produces a false escalation alert — the whole reason
        // snooze_reminder_event exists.
        if (action == DoseAction.ACTION_SNOOZE && medicationId > 0L) {
            AlarmScheduler.scheduleAt(
                context = context,
                medicationId = medicationId,
                drugName = drugName,
                doseLabel = doseLabel,
                fireAt = Instant.now().plusSeconds(AlarmActivity.SNOOZE_MINUTES * 60L),
                audioPath = audioPath,
                photoPath = photoPath,
            )
            Log.i(
                AlarmScheduler.TAG,
                "snoozed med $medicationId by ${AlarmActivity.SNOOZE_MINUTES} min from the notification",
            )
        }

        // Clear the ringing notification straight away — synchronously, before the
        // queue write — so the UI responds instantly to the tap. Also clear any
        // missed-dose fallback for the same dose: answering it is exactly the
        // acknowledgement that notification was chasing.
        val manager = context.getSystemService(NotificationManager::class.java)
        if (medicationId > 0L) {
            manager?.cancel(medicationId.toInt())
            manager?.cancel(DoseNotifications.missedNotificationId(medicationId))
        }

        // If the full-screen alarm happens to be up for this same dose (the user
        // pulled down the shade over it), stop it — otherwise it would keep
        // ringing after the dose was already answered. The queue itself is safe
        // either way: resolve_reminder_event is idempotent on
        // (medication_id, scheduled_for), so a duplicate answer is a no-op
        // server-side. This is about not ringing at someone who just answered.
        context.sendBroadcast(
            Intent(ACTION_ANSWERED)
                .setPackage(context.packageName)
                .putExtra(AlarmScheduler.EXTRA_MEDICATION_ID, medicationId),
        )

        // goAsync: a BroadcastReceiver is killable the moment onReceive returns,
        // and the Room write must not be racing that.
        val pending = goAsync()
        val appContext = context.applicationContext
        CoroutineScope(Dispatchers.IO).launch {
            try {
                DoseActionQueue.record(
                    context = appContext,
                    medicationId = medicationId,
                    drugName = drugName,
                    scheduledFor = scheduledFor,
                    action = action,
                    snoozeMinutes = if (action == DoseAction.ACTION_SNOOZE) AlarmActivity.SNOOZE_MINUTES else null,
                )
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val ACTION_TAKEN = "com.reminderhealth.app.action.DOSE_TAKEN"
        const val ACTION_SKIP = "com.reminderhealth.app.action.DOSE_SKIP"
        const val ACTION_SNOOZE = "com.reminderhealth.app.action.DOSE_SNOOZE"

        /**
         * Internal, in-process only (`setPackage` + a non-exported receiver
         * registration): tells a visible [AlarmActivity] that this dose was just
         * answered from the notification, so it should stop ringing and close.
         */
        const val ACTION_ANSWERED = "com.reminderhealth.app.action.DOSE_ANSWERED"
    }
}
