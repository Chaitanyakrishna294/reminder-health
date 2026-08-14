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
            isRetry = intent.getBooleanExtra(AlarmScheduler.EXTRA_IS_RETRY, false),
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
                // Any pending snooze for this dose has now been delivered — this
                // IS the re-prompt. Clearing it before rescheduling matters: a
                // stale row would make rescheduleAll try to re-register a snooze
                // whose moment has passed on every subsequent sync.
                runCatching { ScheduleDatabase.getInstance(context).pendingSnoozeDao().clear(medicationId) }

                val db = ScheduleDatabase.getInstance(context)
                val medication = db.medicationDao().getById(medicationId)
                when {
                    medication == null ->
                        Log.w(AlarmScheduler.TAG, "med $medicationId no longer in the local store; not rescheduling")
                    !medication.active ->
                        Log.i(AlarmScheduler.TAG, "med $medicationId is now inactive; not rescheduling")
                    else -> {
                        /*
                         * IS THIS THE FIRST RING, OR A RUNG?
                         *
                         * Derived from the stored ladder rather than an intent
                         * extra, deliberately: extras do not survive a reboot,
                         * and after one the rebuilt rung has to behave exactly
                         * like the rung it replaced. The table is the only thing
                         * that knows, so it is the thing asked.
                         *
                         * The doseAt comparison matters. A ladder row left over
                         * from an EARLIER dose of the same medication would
                         * otherwise make this ring look like a rung and quietly
                         * inherit the wrong dose's remaining offsets.
                         */
                        val ladder = db.pendingRetryDao().get(medicationId)
                        val isRung = ladder != null && ladder.doseAt == scheduledFor

                        val doseAt = runCatching { Instant.parse(scheduledFor) }.getOrNull()
                        val ladderLives = when {
                            doseAt == null -> false
                            isRung -> AlarmScheduler.advanceLadder(context, medication, ladder!!)
                            else -> {
                                // A stale ladder from a previous dose: this ring
                                // supersedes it.
                                if (ladder != null) db.pendingRetryDao().clear(medicationId)
                                AlarmScheduler.startLadder(context, medication, doseAt)
                            }
                        }

                        if (ladderLives) {
                            // The medication's single alarm slot now holds the
                            // next rung. The next DOSE is re-registered by
                            // whichever fire ends the ladder — see the block
                            // comment on AlarmScheduler's ladder section.
                            return@launch
                        }

                        // Ladder exhausted (or none configured). Leave the
                        // honest record and put the next dose back.
                        if (doseAt != null) {
                            DoseNotifications.showMissedDose(
                                context = context,
                                medicationId = medicationId,
                                drugName = drugName,
                                doseLabel = doseLabel,
                                scheduledForIso = scheduledFor,
                                audioPath = intent.getStringExtra(AlarmScheduler.EXTRA_AUDIO_PATH),
                                photoPath = intent.getStringExtra(AlarmScheduler.EXTRA_PHOTO_PATH),
                            )
                        }
                        // From "now", so the dose that just fired is behind us
                        // and this lands on the following one.
                        AlarmScheduler.scheduleNext(context, medication, Instant.now())
                    }
                }
            } catch (e: Exception) {
                Log.e(AlarmScheduler.TAG, "failed to reschedule med $medicationId", e)
            } finally {
                pending.finish()
            }
        }
    }
}
