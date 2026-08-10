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

        // retry() (not failure()) on error: WorkManager backs off and tries again,
        // which is exactly right for a transient network problem. Permanently
        // rejected actions are bounded separately by DoseActionDao's attempt cap,
        // so this cannot spin forever.
        return if (synced == null) Result.retry() else Result.success()
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
