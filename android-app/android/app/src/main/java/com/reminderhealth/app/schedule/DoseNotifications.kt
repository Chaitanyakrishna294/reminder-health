package com.reminderhealth.app.schedule

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.reminderhealth.app.MainActivity
import com.reminderhealth.app.R

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
     * @param medicationId used as the notification id, so a re-fire for the
     *   same medication replaces its own notification instead of stacking.
     */
    fun showDoseReminder(
        context: Context,
        medicationId: Long,
        drugName: String,
        doseLabel: String?,
        scheduledForIso: String?,
    ) {
        ensureChannel(context)

        val openApp = PendingIntent.getActivity(
            context,
            medicationId.toInt(),
            Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        @Suppress("DEPRECATION") // Notification.Builder(Context) — needed for minSdk 23; channel set below on O+.
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(context, CHANNEL_ID)
        } else {
            Notification.Builder(context)
        }

        val notification = builder
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Time to take $drugName")
            .setContentText(doseLabel ?: "Tap to open Re-MIND-eЯ")
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_ALARM)
            .setContentIntent(openApp)
            .also { b ->
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                    @Suppress("DEPRECATION")
                    b.setPriority(Notification.PRIORITY_HIGH)
                }
                if (scheduledForIso != null) {
                    b.setSubText(scheduledForIso)
                }
            }
            .build()

        val manager = context.getSystemService(NotificationManager::class.java) ?: run {
            Log.e(AlarmScheduler.TAG, "NotificationManager unavailable; cannot show dose reminder")
            return
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
