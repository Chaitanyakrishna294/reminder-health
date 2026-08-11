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
 * not, how to get the user to the screen that fixes it.
 *
 * Chinese-OEM skins (Xiaomi/MIUI, Oppo & Realme/ColorOS, Vivo/Funtouch/iQOO,
 * Huawei) kill scheduled alarms and block `BOOT_COMPLETED` regardless of what the
 * app declares. Stock battery optimisation does the same, more gently. **Only the
 * user can grant any of it**, so the job here is to detect, explain, and land
 * them as close to the switch as possible.
 *
 * **No new permissions.** `isIgnoringBatteryOptimizations()` is a plain query and
 * every intent opens a settings screen the user then acts on.
 * `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` — which would allow the grant-directly
 * dialog — is deliberately NOT declared: it is not on CLAUDE.md's permission list
 * and Play treats it as sensitive.
 *
 * **Deep-link chains, not single guesses.** OEM settings activities are
 * undocumented internals renamed freely between models and OS versions; on the
 * iQOO test device none of the documented vivo names existed, and the single
 * fallback dropped the user on generic App Info — a screen from which they then
 * hunted for three minutes and failed. So each target is an ORDERED chain from
 * most specific to most generic, every entry resolved before launch, and the one
 * that worked is logged so per-model behaviour can be learned from real devices
 * rather than guessed at.
 */
object DeviceReliability {

    /** An intent worth trying, with a name for the log. */
    private data class Candidate(val id: String, val build: (Context) -> Intent)

    private fun component(id: String, pkg: String, cls: String) =
        Candidate(id) { Intent().setComponent(ComponentName(pkg, cls)) }

    private fun action(id: String, action: String) = Candidate(id) { Intent(action) }

    private fun appDetails(id: String = "appInfo") = Candidate(id) { ctx ->
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.parse("package:${ctx.packageName}"))
    }

    /**
     * Autostart / background-start. Vivo first — it is the verified test device —
     * then the other aggressive skins, then progressively more generic Android
     * screens. `MANAGE_APPLICATIONS_SETTINGS` is second-to-last on purpose: on
     * vivo the real control lives under Settings → Apps → Special app access →
     * Autostart, so the app list is at least the right branch of the tree, while
     * App Info is a dead end for this particular setting.
     */
    private val AUTOSTART_CHAIN = listOf(
        component("vivo.BgStartUpManagerActivity", "com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
        component("vivo.PurviewTabActivity", "com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.PurviewTabActivity"),
        component("iqoo.BgStartUpManager", "com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"),
        component("iqoo.PurviewTabActivity", "com.iqoo.secure", "com.iqoo.secure.safeguard.PurviewTabActivity"),
        component("iqoo.AddWhiteListActivity", "com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"),
        component("vivo.imanager", "com.vivo.imanager", "com.vivo.imanager.activity.MainActivity"),
        component("miui.AutoStart", "com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
        component("coloros.StartupAppList", "com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
        component("coloros.StartupAppList2", "com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"),
        component("oppo.StartupAppList", "com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"),
        component("huawei.StartupNormalAppList", "com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
        component("huawei.ProtectActivity", "com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"),
        component("letv.AutobootManage", "com.letv.android.letvsafe", "com.letv.android.letvsafe.AutobootManageActivity"),
        component("asus.FunctionActivity", "com.asus.mobilemanager", "com.asus.mobilemanager.entry.FunctionActivity"),
        action("android.ManageApplications", Settings.ACTION_MANAGE_APPLICATIONS_SETTINGS),
        appDetails(),
    )

    /**
     * Background power / battery. Vivo's own "high background power consumption"
     * screen first, then the standard optimisation list, then App Info — which on
     * vivo IS the right destination, since the control sits at
     * App info → App battery usage → Background power.
     */
    private val BATTERY_CHAIN = listOf(
        component("vivo.ExcessivePowerManager", "com.vivo.abe", "com.vivo.applicationbehaviorengine.ui.ExcessivePowerManagerActivity"),
        component("iqoo.BackgroundHighPower", "com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BackgroundHighPowerActivity"),
        component("miui.PowerHide", "com.miui.powerkeeper", "com.miui.powerkeeper.ui.HiddenAppsConfigActivity"),
        action("android.IgnoreBatteryOptimizationSettings", Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
        appDetails(),
    )

    private val NOTIFICATION_CHAIN = listOf(
        Candidate("android.AppNotificationSettings") { ctx ->
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
        },
        appDetails(),
    )

    private val EXACT_ALARM_CHAIN = listOf(
        Candidate("android.RequestScheduleExactAlarm") { ctx ->
            Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
                .setData(Uri.parse("package:${ctx.packageName}"))
        },
        appDetails(),
    )

    private val AGGRESSIVE_OEMS = setOf(
        "xiaomi", "redmi", "poco", "oppo", "realme", "vivo", "iqoo", "huawei", "honor", "meizu", "oneplus",
    )

    fun manufacturer(): String = Build.MANUFACTURER ?: "unknown"

    /** Brand as well as manufacturer: a vivo-made phone reports BRAND=iQOO. */
    fun brand(): String = Build.BRAND ?: "unknown"

    fun isAggressiveOem(): Boolean {
        val make = "${Build.MANUFACTURER} ${Build.BRAND}".lowercase()
        return AGGRESSIVE_OEMS.any { make.contains(it) }
    }

    fun isIgnoringBatteryOptimizations(context: Context): Boolean {
        val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
        return runCatching { power.isIgnoringBatteryOptimizations(context.packageName) }.getOrDefault(false)
    }

    fun areNotificationsEnabled(context: Context): Boolean =
        runCatching { NotificationManagerCompat.from(context).areNotificationsEnabled() }.getOrDefault(false)

    fun canUseFullScreenIntent(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return true
        val manager = context.getSystemService(NotificationManager::class.java) ?: return false
        return runCatching { manager.canUseFullScreenIntent() }.getOrDefault(false)
    }

    /**
     * True when a dedicated autostart screen exists — i.e. whether the user gets
     * "here is the screen" or "here is where to look". Never used to decide
     * whether to WARN: that is driven by the manufacturer, because a ROM nobody
     * has catalogued is not a ROM that behaves itself.
     */
    fun hasAutostartSettings(context: Context): Boolean =
        AUTOSTART_CHAIN.dropLast(2).any { resolves(context, it) }

    /**
     * Walks [chain] and launches the first entry that resolves.
     *
     * @return the id of whichever one opened, or null if every attempt failed.
     *   Logged either way — this is how the candidate list gets better, from real
     *   devices instead of from blog posts.
     */
    fun open(context: Context, target: String): String? {
        val chain = when (target) {
            "battery" -> BATTERY_CHAIN
            "autostart" -> AUTOSTART_CHAIN
            "notifications" -> NOTIFICATION_CHAIN
            "exactAlarms" -> EXACT_ALARM_CHAIN
            else -> return null
        }

        for (candidate in chain) {
            val intent = runCatching { candidate.build(context) }.getOrNull() ?: continue
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (!resolves(context, candidate)) continue
            val launched = runCatching { context.startActivity(intent); true }
                .onFailure { Log.w(AlarmScheduler.TAG, "reliability '$target': ${candidate.id} resolved but would not start", it) }
                .getOrDefault(false)
            if (launched) {
                Log.i(AlarmScheduler.TAG, "reliability '$target' opened via ${candidate.id} on ${brand()}/${manufacturer()}")
                return candidate.id
            }
        }

        Log.w(
            AlarmScheduler.TAG,
            "reliability '$target': NO intent could be opened on ${brand()}/${manufacturer()} " +
                "(${chain.size} candidates tried) — the user needs the written steps",
        )
        return null
    }

    private fun resolves(context: Context, candidate: Candidate): Boolean {
        val intent = runCatching { candidate.build(context) }.getOrNull() ?: return false
        @Suppress("DEPRECATION")
        return runCatching { context.packageManager.resolveActivity(intent, 0) }.getOrNull() != null
    }
}
