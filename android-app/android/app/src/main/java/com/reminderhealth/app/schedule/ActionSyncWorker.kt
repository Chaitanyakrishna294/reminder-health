package com.reminderhealth.app.schedule

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters

/**
 * Drains the action queue when the network comes back.
 *
 * A ONE-SHOT request with a CONNECTED constraint, never a periodic poll —
 * CLAUDE.md's rule is "WorkManager with network + battery constraints, never a
 * fixed-interval poll", and this is the sanctioned shape: the OS wakes it once
 * connectivity exists and it exits.
 *
 * Without this, an action tapped in airplane mode would sit queued until the user
 * happened to open the app again — which for a caregiver watching the dashboard
 * could be hours of looking like a missed dose.
 */
class ActionSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val synced = runCatching { ActionSync.flush(applicationContext) }
            .onFailure { Log.e(AlarmScheduler.TAG, "ActionSyncWorker failed", it) }
            .getOrNull()

        if (synced == null) return Result.retry()

        // flush() does NOT throw when an individual action is rejected — it marks
        // that action failed and moves on, so it can return normally having synced
        // nothing. Reporting success on that would mean WorkManager schedules no
        // backoff retry, leaving the action to wait for whatever incidentally
        // calls flush() next (an app open, the next alarm, a reboot). That was
        // real: a server-side 400 on 2026-08-11 produced two failed attempts
        // followed by "Worker result SUCCESS".
        //
        // So the worker's verdict comes from the QUEUE, not from flush() merely
        // returning. Anything still pending means try again with backoff.
        // Retry-exhausted actions drop out of pending() by definition, so this
        // cannot spin forever.
        val stillPending = runCatching {
            ScheduleDatabase.getInstance(applicationContext).doseActionDao().pending()
        }.getOrNull()

        return if (stillPending.isNullOrEmpty()) {
            Result.success()
        } else {
            Log.i(
                AlarmScheduler.TAG,
                "${stillPending.size} dose action(s) still unsynced after flush — asking WorkManager to retry",
            )
            Result.retry()
        }
    }

    companion object {
        private const val WORK_NAME = "dose-action-sync"

        /**
         * Queues a drain. KEEP policy so several rapid taps coalesce into one
         * job instead of stacking a job per action.
         */
        fun enqueue(context: Context) {
            val request = OneTimeWorkRequestBuilder<ActionSyncWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .build()

            WorkManager.getInstance(context.applicationContext)
                .enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.KEEP, request)
        }
    }
}
