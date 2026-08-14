package com.reminderhealth.app.schedule

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.reminderhealth.app.R
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Dose-reminder notifications.
 *
 * The notification is not a fallback for the alarm — much of the time it IS the
 * alarm. Android attaches a **full-screen intent** here (the documented way to
 * get an alarm-clock takeover without `SYSTEM_ALERT_WINDOW`, which CLAUDE.md
 * forbids) and then decides how to present it:
 *
 *  - phone **locked or idle** → the full-screen [AlarmActivity] takes over;
 *  - phone **unlocked and in active use** → a heads-up notification instead.
 *
 * That second case is Android deliberately not hijacking the screen of someone
 * who is demonstrably already using their phone. It is correct behaviour and is
 * not overridden anywhere in this app. The consequence for design: the
 * notification must be *fully answerable on its own*, which is why Taken / Skip
 * / Snooze are attached as actions and routed through [DoseActionReceiver] into
 * the same offline queue the full-screen buttons use. Nobody should have to open
 * a takeover screen to answer a dose they are awake for.
 *
 * **Persistence, and its Android 14+ limit.** Both the live alarm and the missed
 * fallback are `setOngoing(true)` + `setAutoCancel(false)`: an unanswered dose
 * must not vanish on a careless swipe, and it stays until the dose is actually
 * resolved (Taken/Skip recorded, or snoozed, which reschedules it). On Android
 * 14+ a user can still *deliberately* dismiss an ongoing notification — the
 * platform stopped treating `setOngoing` as absolute. That is accepted rather
 * than fought: the missed-dose fallback and, above all, the server-side
 * escalation ladder are the real backstop for a dose nobody answers. A
 * notification the OS lets someone dismiss is not the last line of defence, and
 * trying to make it one is how apps end up abusing foreground services.
 */
object DoseNotifications {
    private const val CHANNEL_ID = "dose_reminders"
    private const val CHANNEL_NAME = "Medication reminders"
    private const val MISSED_CHANNEL_ID = "dose_missed"
    private const val MISSED_CHANNEL_NAME = "Missed doses"

    /**
     * Idempotent — safe to call on every notification. IMPORTANCE_HIGH is
     * required for a heads-up notification now, and is also the minimum the
     * full-screen intent in step 4 will need.
     */
    @JvmStatic
    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        // No setBypassDnd(true) here: that silently does nothing without
        // ACCESS_NOTIFICATION_POLICY, which is NOT on CLAUDE.md's allowed
        // permission list — so it would have been misleading code implying a
        // guarantee the app cannot make. IMPORTANCE_HIGH is what actually buys
        // the heads-up + sound, and step 4's full-screen intent is what makes a
        // dose alarm genuinely hard to miss.
        val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Alerts when it is time to take a medication"
            enableVibration(true)
        }
        manager.createNotificationChannel(channel)
    }

    /**
     * Fallback posted when an alarm rings unattended and auto-dismisses.
     *
     * Without this, the auto-timeout path CANCELLED the alarm notification and
     * left nothing behind — a patient who slept through a dose woke to no trace
     * of it. Losing the reminder is worse than the ringing stopping.
     *
     * Deliberately quiet and non-ringing: no full-screen intent, no sound
     * (IMPORTANCE_LOW channel), so it cannot itself become a battery or
     * attention problem. Tapping it reopens the alarm screen — which is pure
     * native, so the dose can still be recorded with no network.
     */
    fun showMissedDose(
        context: Context,
        medicationId: Long,
        drugName: String,
        doseLabel: String?,
        scheduledForIso: String?,
        audioPath: String? = null,
        photoPath: String? = null,
    ) {
        ensureMissedChannel(context)

        val reopen = PendingIntent.getActivity(
            context,
            // Offset the request code so this PendingIntent is distinct from the
            // alarm's own for the same medication.
            (medicationId + 1_000_000L).toInt(),
            alarmIntent(context, medicationId, drugName, doseLabel, scheduledForIso, audioPath, photoPath),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        fun act(action: String) = actionIntent(
            context, action, medicationId, drugName, doseLabel, scheduledForIso, audioPath, photoPath,
        )

        val notification = NotificationCompat.Builder(context, MISSED_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Missed: take $drugName")
            .setContentText(
                listOfNotNull(doseLabel, localTimeOrNull(scheduledForIso)?.let { "due $it" })
                    .joinToString(" · ")
                    .ifEmpty { "Tap to record this dose" },
            )
            // The same three actions as the live alarm. These are not optional
            // here: this notification is PERSISTENT, so without a way to answer
            // the dose from it, it would be a permanently stuck notification.
            // Snooze included on purpose — "remind me in 10 minutes" is a
            // perfectly good answer to a dose you slept through.
            .addAction(0, context.getString(R.string.alarm_taken), act(DoseActionReceiver.ACTION_TAKEN))
            .addAction(0, context.getString(R.string.alarm_skip), act(DoseActionReceiver.ACTION_SKIP))
            .addAction(0, context.getString(R.string.alarm_snooze), act(DoseActionReceiver.ACTION_SNOOZE))
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(reopen)
            // Persistent, like the alarm notification it replaces: an unanswered
            // dose should not be clearable with an absent-minded swipe. It stays
            // until the dose is actually resolved. See the class comment for the
            // Android 14+ caveat — a determined user can still dismiss it, and
            // that is fine, because server-side escalation is the real backstop.
            .setAutoCancel(false)
            .setOngoing(true)
            .build()

        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.notify(missedNotificationId(medicationId), notification)
        Log.i(AlarmScheduler.TAG, "posted MISSED fallback notification for med $medicationId ($drugName)")
    }

    /** Distinct id so the missed notification doesn't overwrite a live alarm's. */
    fun missedNotificationId(medicationId: Long): Int = (medicationId + 1_000_000L).toInt()

    /** IMPORTANCE_LOW: visible and persistent, but silent — it must not ring again. */
    private fun ensureMissedChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(MISSED_CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(MISSED_CHANNEL_ID, MISSED_CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW).apply {
                description = "A dose alarm that rang without being answered"
            },
        )
    }

    /**
     * A Taken/Skip button on the notification, handled by [DoseActionReceiver]
     * with no UI at all.
     *
     * PendingIntent equality ignores extras, so without a distinct data URI per
     * (medication, action) the two buttons — and every medication's buttons —
     * would collapse into one and carry whichever extras were registered first.
     * That would mean tapping Skip on one medication recording Taken on another.
     * The request code alone is not enough; the data URI is what makes them
     * genuinely different intents.
     */
    private fun actionIntent(
        context: Context,
        action: String,
        medicationId: Long,
        drugName: String,
        doseLabel: String?,
        scheduledForIso: String?,
        audioPath: String?,
        photoPath: String?,
    ): PendingIntent {
        val slug = action.substringAfterLast('.')
        val intent = Intent(context, DoseActionReceiver::class.java).apply {
            this.action = action
            data = Uri.parse("reminderhealth://dose/$medicationId/$slug")
            putExtra(AlarmScheduler.EXTRA_MEDICATION_ID, medicationId)
            putExtra(AlarmScheduler.EXTRA_DRUG_NAME, drugName)
            // Snooze re-registers a real alarm from this receiver, so it needs
            // everything AlarmScheduler.scheduleAt would otherwise read from the
            // store — including the voice/photo paths, or a snoozed alarm would
            // silently lose the family voice message the first one had.
            putExtra(AlarmScheduler.EXTRA_DOSE_LABEL, doseLabel)
            putExtra(AlarmScheduler.EXTRA_SCHEDULED_FOR, scheduledForIso)
            putExtra(AlarmScheduler.EXTRA_AUDIO_PATH, audioPath)
            putExtra(AlarmScheduler.EXTRA_PHOTO_PATH, photoPath)
        }
        return PendingIntent.getBroadcast(
            context,
            // Distinct from the full-screen intent's code (medicationId.toInt())
            // and from the missed fallback's (+1_000_000).
            (medicationId + ACTION_REQUEST_CODE_BASE + slug.hashCode()).toInt(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** Keeps notification-action request codes clear of the other two families. */
    private const val ACTION_REQUEST_CODE_BASE = 2_000_000L

    /** Shared by the alarm notification and the missed fallback. */
    private fun alarmIntent(
        context: Context,
        medicationId: Long,
        drugName: String,
        doseLabel: String?,
        scheduledForIso: String?,
        audioPath: String?,
        photoPath: String?,
    ): Intent = Intent(context, AlarmActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        data = Uri.parse("reminderhealth://alarm/$medicationId")
        putExtra(AlarmScheduler.EXTRA_MEDICATION_ID, medicationId)
        putExtra(AlarmScheduler.EXTRA_DRUG_NAME, drugName)
        putExtra(AlarmScheduler.EXTRA_DOSE_LABEL, doseLabel)
        putExtra(AlarmScheduler.EXTRA_SCHEDULED_FOR, scheduledForIso)
        putExtra(AlarmScheduler.EXTRA_AUDIO_PATH, audioPath)
        putExtra(AlarmScheduler.EXTRA_PHOTO_PATH, photoPath)
    }

    /**
     * The dose's scheduled instant as a readable LOCAL time ("2:35 AM").
     *
     * Everything on the wire is ISO-8601 UTC (`2026-08-10T21:05:00Z`) because
     * that is the only unambiguous way to carry an instant — but showing that
     * raw to a patient is useless, and worse, off by the UTC offset so it looks
     * like the alarm fired at the wrong time. Matches how AlarmActivity formats
     * the same value, so the notification and the alarm screen never disagree.
     */
    private fun localTimeOrNull(iso: String?): String? {
        if (iso == null) return null
        return runCatching {
            DateTimeFormatter.ofPattern("h:mm a")
                .withZone(ZoneId.systemDefault())
                .format(Instant.parse(iso))
        }.getOrNull()
    }

    /**
     * @param medicationId used as the notification id, so a re-fire for the
     *   same medication replaces its own notification instead of stacking.
     */
    /**
     * [isRetry] changes the WORDING and nothing else.
     *
     * "Still time to take X" rather than "Time to take X": the second and third
     * ask must read as the app being patient, not as the app being cross. There
     * is no "again", no "you still have not", and no count -- a person who has
     * not answered twice already knows, and telling them is the one thing this
     * screen must never do. The sticky that follows keeps its own honest
     * record-keeping wording; that is a different job.
     */
    fun showDoseReminder(
        context: Context,
        medicationId: Long,
        drugName: String,
        doseLabel: String?,
        scheduledForIso: String?,
        audioPath: String? = null,
        photoPath: String? = null,
        isRetry: Boolean = false,
    ) {
        ensureChannel(context)

        // The full-screen intent: this is what makes the alarm take over the
        // screen (and show over the keyguard) WITHOUT SYSTEM_ALERT_WINDOW.
        // Android treats it as "launch this if the device is locked/idle,
        // otherwise show a heads-up notification" — so the notification is
        // still the fallback, never a dead end.
        val alarmIntent = Intent(context, AlarmActivity::class.java).apply {
            // NEW_TASK only. FLAG_ACTIVITY_CLEAR_TASK was here and had to go: it
            // clears the task the activity lands in, and on 2026-08-11 the app
            // would not reopen at all after an alarm was answered — a cleared
            // task record the launcher still resolved to. The alarm needs its own
            // task (taskAffinity="" in the manifest handles that); it has no
            // business clearing anything, and nothing is ever stacked under it.
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            data = Uri.parse("reminderhealth://alarm/$medicationId")
            putExtra(AlarmScheduler.EXTRA_MEDICATION_ID, medicationId)
            putExtra(AlarmScheduler.EXTRA_DRUG_NAME, drugName)
            putExtra(AlarmScheduler.EXTRA_DOSE_LABEL, doseLabel)
            putExtra(AlarmScheduler.EXTRA_SCHEDULED_FOR, scheduledForIso)
            putExtra(AlarmScheduler.EXTRA_AUDIO_PATH, audioPath)
            putExtra(AlarmScheduler.EXTRA_PHOTO_PATH, photoPath)
        }
        val fullScreen = PendingIntent.getActivity(
            context,
            medicationId.toInt(),
            alarmIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        fun act(action: String) = actionIntent(
            context, action, medicationId, drugName, doseLabel, scheduledForIso, audioPath, photoPath,
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(if (isRetry) "Still time to take $drugName" else "Time to take $drugName")
            .setContentText(doseLabel ?: "Tap to open Re-MIND-eЯ")
            // All three actions straight on the notification. When the phone is
            // unlocked and in use, Android suppresses the full-screen intent and
            // this heads-up notification IS the alarm — so it has to be fully
            // answerable on its own, not a signpost to another screen. Order
            // mirrors the alarm screen's S30 hierarchy: primary, honest decline,
            // deferral last.
            .addAction(0, context.getString(R.string.alarm_taken), act(DoseActionReceiver.ACTION_TAKEN))
            .addAction(0, context.getString(R.string.alarm_skip), act(DoseActionReceiver.ACTION_SKIP))
            .addAction(0, context.getString(R.string.alarm_snooze), act(DoseActionReceiver.ACTION_SNOOZE))
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            // Shows content (not "contents hidden") on the lock screen, which is
            // where a dose alarm most needs to be readable.
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            // Tapping opens the alarm screen itself, not the webview — so alarm
            // interaction never depends on the network. This is the real fix for
            // the offline white-screen found in step-3 testing.
            .setContentIntent(fullScreen)
            .setFullScreenIntent(fullScreen, true)
            // Not auto-cancel / not dismissible by swipe: a dose alarm should be
            // answered. AlarmActivity cancels it on action or auto-timeout.
            .setAutoCancel(false)
            .setOngoing(true)
            .also { b -> localTimeOrNull(scheduledForIso)?.let { b.setSubText(it) } }
            .build()

        val manager = context.getSystemService(NotificationManager::class.java) ?: run {
            Log.e(AlarmScheduler.TAG, "NotificationManager unavailable; cannot show dose reminder")
            return
        }

        // Android 14+ gates full-screen intents behind a permission that is
        // auto-granted only to alarm-class apps. If it is ever denied the alarm
        // degrades to a heads-up notification rather than failing — worth
        // knowing which of the two the user is actually getting.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && !manager.canUseFullScreenIntent()) {
            Log.w(
                AlarmScheduler.TAG,
                "USE_FULL_SCREEN_INTENT not granted — alarm will show as a heads-up " +
                    "notification instead of taking over the screen",
            )
        }

        // The single most useful line when "the alarm fired but I saw nothing":
        // on Android 13+ a denied POST_NOTIFICATIONS (or an OEM battery/
        // notification restriction) makes notify() a silent no-op, which is
        // indistinguishable from a broken alarm without this.
        if (!manager.areNotificationsEnabled()) {
            Log.e(
                AlarmScheduler.TAG,
                "ALARM FIRED but notifications are DISABLED for this app at the OS level — " +
                    "notify() will be silently dropped. Check Settings > Apps > Re-MIND-eЯ > Notifications.",
            )
        }

        manager.notify(medicationId.toInt(), notification)
        Log.i(AlarmScheduler.TAG, "notification posted for med $medicationId ($drugName)")
    }
}
