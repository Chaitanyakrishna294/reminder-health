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
 * Runs when an exact alarm fires. **Pure native — never touches the webview**
 * (CLAUDE.md hard rule): it reads the local Room store, posts the
 * notification, and re-registers this medication's next alarm. The app does
 * not need to be running, and the webview is not started or resumed.
 *
 * Two responsibilities, in this order:
 *  1. Notify immediately (synchronously) — the whole point of the alarm.
 *  2. Re-register the NEXT dose for this medication. This is what keeps the
 *     chain going forever without any polling or repeating alarm.
 */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val medicationId = intent.getLongExtra(AlarmScheduler.EXTRA_MEDICATION_ID, -1L)
        val drugName = intent.getStringExtra(AlarmScheduler.EXTRA_DRUG_NAME) ?: "your medication"
        val doseLabel = intent.getStringExtra(AlarmScheduler.EXTRA_DOSE_LABEL)
        val scheduledFor = intent.getStringExtra(AlarmScheduler.EXTRA_SCHEDULED_FOR)

        Log.i(
            AlarmScheduler.TAG,
            "ALARM FIRED for med $medicationId ($drugName) — scheduled for $scheduledFor, now ${Instant.now()}",
        )

        DoseNotifications.showDoseReminder(
            context = context,
            medicationId = medicationId,
            drugName = drugName,
            doseLabel = doseLabel,
            scheduledForIso = scheduledFor,
            audioPath = intent.getStringExtra(AlarmScheduler.EXTRA_AUDIO_PATH),
            photoPath = intent.getStringExtra(AlarmScheduler.EXTRA_PHOTO_PATH),
        )

        if (medicationId <= 0L) {
            // Debug/test alarm (see ScheduleBridgePlugin.scheduleTestAlarm) —
            // no medication row behind it, so nothing to reschedule.
            return
        }

        // Room access is suspend/off-main-thread, but onReceive must return
        // promptly. goAsync() keeps the receiver alive for the short DB read;
        // pending.finish() releases it. Not a background service, not a timer:
        // it ends as soon as the next alarm is registered.
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val medication = ScheduleDatabase.getInstance(context).medicationDao().getById(medicationId)
                when {
                    medication == null ->
                        Log.w(AlarmScheduler.TAG, "med $medicationId no longer in the local store; not rescheduling")
                    !medication.active ->
                        Log.i(AlarmScheduler.TAG, "med $medicationId is now inactive; not rescheduling")
                    else ->
                        // From "now", so the dose that just fired is behind us
                        // and this lands on the following one.
                        AlarmScheduler.scheduleNext(context, medication, Instant.now())
                }
            } catch (e: Exception) {
                Log.e(AlarmScheduler.TAG, "failed to reschedule med $medicationId", e)
            } finally {
                pending.finish()
            }
        }
    }
}
