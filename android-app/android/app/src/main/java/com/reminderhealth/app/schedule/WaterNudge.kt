package com.reminderhealth.app.schedule

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.reminderhealth.app.R
import java.time.Instant
import java.time.ZoneId

/**
 * WATER NUDGES — the quietest thing in the product, by design.
 *
 * CLAUDE.md's water rule in one place:
 *  - an ordinary, SWIPEABLE notification on its own low-importance channel;
 *  - **never** the full-screen alarm path, no retry ladder, no missed tracking,
 *    no escalation, no streaks;
 *  - ignoring one records NOTHING — a missed water day says nothing about
 *    anybody, and nothing here writes that it happened;
 *  - if the goal is already met, the remaining nudges silently skip.
 *
 * **INEXACT, and that is a hard rule.** This is WorkManager, not `AlarmManager`.
 * Exact alarms are medication-only; a glass of water does not earn one, and it
 * does not earn the battery either. Android is free to shift these by minutes and
 * that is fine — nobody is harmed by a late reminder to drink.
 *
 * ONE JOB AT A TIME, chained. Each firing schedules the next, exactly like the
 * dose alarm chain, so there is no polling and no repeating job accumulating
 * duplicates across syncs.
 */
object WaterNudge {

    private const val CHANNEL_ID = "water_nudges"
    private const val CHANNEL_NAME = "Water reminders"
    private const val WORK_NAME = "water-nudge"
    private const val NOTIFICATION_ID = 900_000_001

    const val ACTION_DRANK = "com.reminderhealth.app.action.WATER_DRANK"

    /**
     * IMPORTANCE_LOW: it appears in the shade and does not interrupt. Not
     * IMPORTANCE_MIN (which hides it) and emphatically not HIGH — the dose
     * channel is high because a missed dose matters, and putting water on the
     * same footing is how people learn to swipe both away.
     */
    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW).apply {
                description = "Gentle reminders to drink water. Never full-screen."
                enableVibration(false)
                setShowBadge(false)
            },
        )
    }

    /** (Re)arm the chain. Called after a sync and after each firing. */
    fun schedule(context: Context, from: Instant = Instant.now()) {
        val work = WorkManager.getInstance(context.applicationContext)
        if (!WaterPrefs.isEnabled(context)) {
            work.cancelUniqueWork(WORK_NAME)
            return
        }
        val next = WaterSchedule.nextNudgeAfter(from, ZoneId.systemDefault(), WaterPrefs.nudgeMinutes(context))
        if (next == null) {
            work.cancelUniqueWork(WORK_NAME)
            return
        }
        val delay = WaterSchedule.delayUntil(from, next)
        work.enqueueUniqueWork(
            WORK_NAME,
            // REPLACE, so a re-sync moves the pending nudge instead of stacking a
            // second one behind it.
            ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<WaterNudgeWorker>().setInitialDelay(delay).build(),
        )
        Log.i(AlarmScheduler.TAG, "water: next nudge at $next (in ${delay.toMinutes()} min, inexact)")
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context.applicationContext).cancelUniqueWork(WORK_NAME)
        clearNotification(context)
    }

    private fun clearNotification(context: Context) {
        context.getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION_ID)
    }

    /**
     * Post the nudge — unless the goal is already met, in which case it silently
     * skips. Someone who has finished should not be told about water again, and
     * being told "you're done!" is a celebration nobody asked for.
     */
    fun post(context: Context) {
        val goal = WaterPrefs.goalCups(context)
        val cups = WaterPrefs.cupsToday(context)
        if (goal > 0 && cups >= goal) {
            Log.i(AlarmScheduler.TAG, "water: goal already met ($cups/$goal) — skipping this nudge")
            return
        }
        ensureChannel(context)

        val drank = PendingIntent.getBroadcast(
            context,
            NOTIFICATION_ID,
            Intent(context, WaterActionReceiver::class.java).apply {
                action = ACTION_DRANK
                data = Uri.parse("reminderhealth://water/drank")
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_water_drop)
            // The scoped hydration accent, so a glass of water is never mistaken
            // for a dose even at a glance in the shade.
            .setColor(0xFF38A3D1.toInt())
            .setColorized(false)
            .setContentTitle("Time for a glass of water")
            .setContentText(if (goal > 0) "$cups of $goal today" else "Tap Taken to count it")
            // ONE action. "Taken" adds a cup; there is deliberately no Skip,
            // because skipping water is not an event worth recording.
            .addAction(0, "Taken", drank)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            // SWIPEABLE, and nothing happens when it is swiped. The opposite of
            // the dose notification in every respect.
            .setAutoCancel(true)
            .setOngoing(false)
            .setSilent(true)
            .build()

        context.getSystemService(NotificationManager::class.java)?.notify(NOTIFICATION_ID, notification)
        Log.i(AlarmScheduler.TAG, "water: nudge posted ($cups/$goal)")
    }

    internal fun dismiss(context: Context) = clearNotification(context)
}

/** "+1 cup" from the notification. Local only — the webview syncs it on next open. */
class WaterActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != WaterNudge.ACTION_DRANK) return
        val cups = WaterPrefs.addCup(context)
        Log.i(AlarmScheduler.TAG, "water: +1 cup from the notification (now $cups)")
        WaterNudge.dismiss(context)
    }
}

/**
 * Posts one nudge, then arms the next. No polling and no PeriodicWorkRequest —
 * a chain cannot accumulate duplicates across re-syncs the way a repeating job
 * can, and it is the same shape the dose alarm chain already uses.
 */
class WaterNudgeWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        runCatching { WaterNudge.post(applicationContext) }
            .onFailure { Log.w(AlarmScheduler.TAG, "water: could not post the nudge", it) }
        runCatching { WaterNudge.schedule(applicationContext) }
        // Always success: a failed water nudge must never retry-storm. The next
        // one is already scheduled, and nothing here is worth a backoff.
        return Result.success()
    }
}
