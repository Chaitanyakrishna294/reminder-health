package com.reminderhealth.app.schedule

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Re-registers every alarm after a reboot.
 *
 * **Android silently drops all `AlarmManager` alarms on shutdown.** Without this,
 * a phone that rebooted overnight would wake up with zero medication reminders
 * and give no sign of it — the worst possible failure mode for this product,
 * because nothing looks broken until a dose is already missed.
 *
 * Reads the local Room store, so it needs no network and no webview: exactly the
 * property that makes the store worth having (CLAUDE.md's "device-side copy").
 *
 * Also drains the action queue, since a reboot is a good moment to retry
 * anything that was still pending.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        // LOCKED_BOOT_COMPLETED can arrive before the user has unlocked (direct
        // boot). MY_PACKAGE_REPLACED matters just as much as a reboot: updating
        // the app also clears its alarms, so without it every install of a new
        // build would silently stop reminding until the app was opened.
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_LOCKED_BOOT_COMPLETED &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED &&
            action != "android.intent.action.QUICKBOOT_POWERON"
        ) {
            return
        }

        Log.i(AlarmScheduler.TAG, "BootReceiver: $action — re-registering alarms from the local store")

        // goAsync() keeps the receiver alive for the Room read; onReceive itself
        // must return promptly. Not a service, and it ends as soon as the alarms
        // are registered.
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                AlarmScheduler.rescheduleAll(context)
                ActionSync.flush(context)
            } catch (e: Exception) {
                Log.e(AlarmScheduler.TAG, "BootReceiver failed to re-register alarms", e)
            } finally {
                pending.finish()
            }
        }
    }
}
