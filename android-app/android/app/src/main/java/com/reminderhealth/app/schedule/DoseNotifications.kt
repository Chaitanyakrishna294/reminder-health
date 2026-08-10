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
 * STEP 3 SCOPE: a plain heads-up notification, deliberately. It exists so the
 * exact-alarm TIMING can be verified on a real device before the full-screen
 * alarm UI (step 4) is layered on. Step 4 attaches a full-screen intent to
 * this same notification — that is the documented way to get an alarm-clock
 * takeover screen without `SYSTEM_ALERT_WINDOW` (see CLAUDE.md).
 */
object DoseNotifications {
    private const val CHANNEL_ID = "dose_reminders"
    private const val CHANNEL_NAME = "Medication reminders"

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
    fun showDoseReminder(
        context: Context,
        medicationId: Long,
        drugName: String,
        doseLabel: String?,
        scheduledForIso: String?,
        audioPath: String? = null,
        photoPath: String? = null,
    ) {
        ensureChannel(context)

        // The full-screen intent: this is what makes the alarm take over the
        // screen (and show over the keyguard) WITHOUT SYSTEM_ALERT_WINDOW.
        // Android treats it as "launch this if the device is locked/idle,
        // otherwise show a heads-up notification" — so the notification is
        // still the fallback, never a dead end.
        val alarmIntent = Intent(context, AlarmActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
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

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Time to take $drugName")
            .setContentText(doseLabel ?: "Tap to open Re-MIND-eЯ")
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
