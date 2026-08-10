package com.reminderhealth.app.schedule

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import com.reminderhealth.app.MainActivity

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

        val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Alerts when it is time to take a medication"
            enableVibration(true)
            setBypassDnd(true)
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

        // Placeholder icon: a built-in platform alarm/reminder glyph, so this
        // step needs no new art. Real branding lands with the UI redesign
        // (CLAUDE.md's redesign section owns the visual tokens).
        val notification = builder
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
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

        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.notify(medicationId.toInt(), notification)
    }
}
