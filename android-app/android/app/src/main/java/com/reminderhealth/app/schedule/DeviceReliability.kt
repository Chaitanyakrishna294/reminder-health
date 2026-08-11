package com.reminderhealth.app.schedule

import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationManagerCompat

/**
 * Whether this device will actually let the alarm core work — and, where it will
 * not, how to send the user to the screen that fixes it.
 *
 * Chinese-OEM skins (Xiaomi/MIUI, Oppo & Realme/ColorOS, Vivo/Funtouch, Huawei)
 * ship aggressive background managers that kill scheduled alarms and block
 * `BOOT_COMPLETED` receivers regardless of what the app declares. Stock Android's
 * battery optimisation does the same, more gently. Neither is something the app
 * can fix for the user: **only the user can grant these**, so the honest product
 * answer is to detect the problem, explain it, and take them to the exact screen.
 *
 * **No new permissions.** `PowerManager.isIgnoringBatteryOptimizations()` is a
 * plain query, and every intent here opens a settings screen the user then acts
 * on. `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` — which would let the app pop the
 * allow-directly dialog — is deliberately NOT declared: it is not on CLAUDE.md's
 * permission list and Play Store policy treats it as a sensitive permission
 * needing justification. Sending the user one tap deeper is worth more than that.
 */
object DeviceReliability {

    /**
     * Known autostart / background-start screens, most specific first.
     *
     * Every one of these is an undocumented internal activity that OEMs rename
     * between OS versions, so each is resolved against the package manager before
     * being offered — never launched blind. An `ActivityNotFoundException` here
     * would crash the app from a button whose entire purpose is reassurance.
     */
    private val AUTOSTART_TARGETS = listOf(
        // Vivo / Funtouch / iQOO. NOTE: on the iQOO test device (vivo I2202) NONE
        // of these resolve — that ROM ships `com.vivo.imanager` instead and does
        // not export an autostart activity under any of the documented names.
        // That is exactly why a missing deep link must NOT hide the guidance; see
        // hasAutostartSettings.
        "com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
        "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager",
        "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity",
        // Xiaomi / MIUI
        "com.miui.securitycenter" to "com.miui.permcenter.autostart.AutoStartManagementActivity",
        // Oppo & Realme / ColorOS
        "com.coloros.safecenter" to "com.coloros.safecenter.permission.startup.StartupAppListActivity",
        "com.coloros.safecenter" to "com.coloros.safecenter.startupapp.StartupAppListActivity",
        "com.oppo.safe" to "com.oppo.safe.permission.startup.StartupAppListActivity",
        // Huawei / EMUI
        "com.huawei.systemmanager" to "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
        "com.huawei.systemmanager" to "com.huawei.systemmanager.optimize.process.ProtectActivity",
        // Samsung / One UI — device care
        "com.samsung.android.lool" to "com.samsung.android.sm.ui.battery.BatteryActivity",
        // Letv / Asus / OnePlus variants seen in the wild
        "com.letv.android.letvsafe" to "com.letv.android.letvsafe.AutobootManageActivity",
        "com.asus.mobilemanager" to "com.asus.mobilemanager.entry.FunctionActivity",
    )

    /**
     * Manufacturers whose skins are known to kill alarms even when battery
     * optimisation is already off, so the autostart step is not optional for them.
     */
    private val AGGRESSIVE_OEMS = setOf(
        "xiaomi", "redmi", "poco", "oppo", "realme", "vivo", "iqoo", "huawei", "honor", "meizu", "oneplus",
    )

    fun manufacturer(): String = Build.MANUFACTURER ?: "unknown"

    /** True when this device's OEM skin is known to need the autostart step. */
    fun isAggressiveOem(): Boolean {
        val make = "${Build.MANUFACTURER} ${Build.BRAND}".lowercase()
        return AGGRESSIVE_OEMS.any { make.contains(it) }
    }

    /**
     * False means Android may defer or drop this app's alarms while dozing —
     * exactly the "alarm didn't fire overnight" failure. Queryable without any
     * permission.
     */
    fun isIgnoringBatteryOptimizations(context: Context): Boolean {
        val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
        return runCatching { power.isIgnoringBatteryOptimizations(context.packageName) }.getOrDefault(false)
    }

    fun areNotificationsEnabled(context: Context): Boolean =
        runCatching { NotificationManagerCompat.from(context).areNotificationsEnabled() }.getOrDefault(false)

    /** Android 14+ gates the alarm takeover screen behind this. */
    fun canUseFullScreenIntent(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return true
        val manager = context.getSystemService(NotificationManager::class.java) ?: return false
        return runCatching { manager.canUseFullScreenIntent() }.getOrDefault(false)
    }

    /**
     * True when a direct link to this device's autostart screen was found.
     *
     * **This is a "can we shortcut it" flag, NOT a "does the user need it" flag.**
     * These activities are undocumented internals that OEMs rename freely — the
     * iQOO test device matched none of the known names despite being exactly the
     * kind of ROM that kills alarms. So the UI shows the guidance based on the
     * MANUFACTURER ([isAggressiveOem]) and uses this only to decide between
     * "here is the screen" and "here is where to look for it". Hiding the warning
     * whenever the shortcut is missing would silence it precisely on the ROMs
     * nobody has catalogued yet.
     */
    fun hasAutostartSettings(context: Context): Boolean = resolveAutostartIntent(context) != null

    /**
     * Opens the battery-optimisation list. Uses the *settings* action rather than
     * the direct-request dialog precisely so no sensitive permission is needed.
     * Falls back to this app's details page, which always exists.
     */
    fun openBatteryOptimizationSettings(context: Context): Boolean {
        val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        return startIfResolvable(context, intent) || openAppDetails(context)
    }

    fun openAutostartSettings(context: Context): Boolean {
        val intent = resolveAutostartIntent(context) ?: return openAppDetails(context)
        return startIfResolvable(context, intent) || openAppDetails(context)
    }

    fun openNotificationSettings(context: Context): Boolean {
        val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        return startIfResolvable(context, intent) || openAppDetails(context)
    }

    /** Android 12+ exact-alarm permission screen, when the user has revoked it. */
    fun openExactAlarmSettings(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return openAppDetails(context)
        val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
            .setData(Uri.parse("package:${context.packageName}"))
        return startIfResolvable(context, intent) || openAppDetails(context)
    }

    private fun resolveAutostartIntent(context: Context): Intent? {
        val pm = context.packageManager
        for ((pkg, cls) in AUTOSTART_TARGETS) {
            val intent = Intent().setComponent(ComponentName(pkg, cls))
            val resolved = runCatching {
                @Suppress("DEPRECATION")
                pm.resolveActivity(intent, 0)
            }.getOrNull()
            if (resolved != null) return intent
        }
        return null
    }

    private fun startIfResolvable(context: Context, intent: Intent): Boolean {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val pm = context.packageManager
        @Suppress("DEPRECATION")
        if (runCatching { pm.resolveActivity(intent, 0) }.getOrNull() == null) return false
        return runCatching { context.startActivity(intent); true }
            .onFailure { Log.w(AlarmScheduler.TAG, "could not open ${intent.action ?: intent.component}", it) }
            .getOrDefault(false)
    }

    private fun openAppDetails(context: Context): Boolean {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.parse("package:${context.packageName}"))
        return startIfResolvable(context, intent)
    }
}
