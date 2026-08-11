package com.reminderhealth.app.schedule

import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Instant

/**
 * The webview<->native bridge from BRIDGE_CONTRACT.md. This M2 step wires
 * syncSchedule only (plus a debug getSchedule to confirm it round-tripped) —
 * setSession and the offline action queue come in a later step.
 *
 * Same shape as M1's PingPlugin (now deleted, superseded by this):
 * `@CapacitorPlugin` names it for JS as `window.Capacitor.Plugins.
 * ScheduleBridge`, each `@PluginMethod` is one callable function, and
 * `call.resolve(...)` / `call.reject(...)` are how a promise on the JS side
 * settles.
 */
@CapacitorPlugin(name = "ScheduleBridge")
class ScheduleBridgePlugin : Plugin() {
    // A background scope for DB work, so it never blocks the UI thread —
    // Kotlin coroutines are the rough equivalent of async/await in JS.
    private val scope = CoroutineScope(Dispatchers.IO)

    /**
     * JS calls this as `ScheduleBridge.syncSchedule({ medications })` — a
     * single options object is Capacitor's calling convention, which is why
     * the array arrives wrapped under the "medications" key rather than as
     * a bare positional argument.
     */
    @PluginMethod
    fun syncSchedule(call: PluginCall) {
        val medicationsArray = call.getArray("medications")
        if (medicationsArray == null) {
            call.reject("syncSchedule requires a 'medications' array")
            return
        }

        val medications = try {
            (0 until medicationsArray.length()).map { i ->
                val m = medicationsArray.getJSONObject(i)
                Medication(
                    id = m.getLong("id"),
                    drugName = m.getString("drugName"),
                    dosage = m.stringOrNull("dosage"),
                    dosageAmount = m.optDouble("dosageAmount", 1.0),
                    unitType = m.stringOrNull("unitType"),
                    reminderTimes = m.getJSONArray("reminderTimes").let { arr ->
                        (0 until arr.length()).map { arr.getString(it) }
                    },
                    doseDays = if (m.isNull("doseDays")) {
                        null
                    } else {
                        m.getJSONArray("doseDays").let { arr -> (0 until arr.length()).map { arr.getInt(it) } }
                    },
                    timezone = m.getString("timezone"),
                    nextReminderAt = m.getString("nextReminderAt"),
                    active = m.getBoolean("active"),
                    medicationReason = m.stringOrNull("medicationReason"),
                )
            }
        } catch (e: Exception) {
            call.reject("syncSchedule payload parse error: ${e.message}")
            return
        }

        val incomingUserId = call.getString("userId")

        scope.launch {
            val dao = ScheduleDatabase.getInstance(context).medicationDao()

            // ACCOUNT SWITCH GUARD. Found on-device 2026-08-11: signed in as a
            // guest, the native store still held the previous account's 12
            // medications and rang for them — alarms for doses the current user
            // does not have. The store must belong to exactly one identity, so a
            // different userId wipes it outright rather than layering on top.
            val currentOwner = SessionStore.ownerUserId(context)
            if (incomingUserId != null && currentOwner != null && incomingUserId != currentOwner) {
                Log.w(
                    AlarmScheduler.TAG,
                    "ACCOUNT SWITCH: store belonged to $currentOwner, sync is for $incomingUserId — " +
                        "cancelling that account's alarms and wiping the local store before syncing",
                )
                AlarmScheduler.cancelAllKnown(context)
                dao.deleteAll()
                // A pending snooze is one account's deferred dose; it must not
                // survive into another's schedule.
                runCatching { ScheduleDatabase.getInstance(context).pendingSnoozeDao().clearAll() }
            }
            if (incomingUserId != null) {
                SessionStore.setOwnerUserId(context, incomingUserId)
            }

            // An empty incoming list is legitimate (all medications deleted) but
            // is ALSO what a signed-out or guest session looks like, and it wipes
            // every alarm on this device. Loud, because it is otherwise invisible
            // and looks exactly like "the alarms just stopped working".
            if (medications.isEmpty() && dao.getAll().isNotEmpty()) {
                Log.w(
                    AlarmScheduler.TAG,
                    "syncSchedule received ZERO medications while the local store is NOT empty — " +
                        "clearing every alarm on this device. If this was unexpected, check WHICH " +
                        "account the webview is signed into (a guest session owns no medications).",
                )
            }

            // Cancel the OLD set's alarms before the store is replaced, or
            // deleted medications leave orphaned alarms behind (see cancelAllKnown).
            AlarmScheduler.cancelAllKnown(context)
            dao.replaceAll(medications)
            // Alarms are re-registered from the store immediately, so a
            // medication edit takes effect without waiting for anything.
            AlarmScheduler.rescheduleAll(context)

            val result = JSObject()
            result.put("synced", medications.size)
            result.put("canScheduleExactAlarms", AlarmScheduler.canScheduleExact(context))
            call.resolve(result)
        }
    }

    /**
     * `clearSchedule()` — called by the web on logout / login / account switch.
     *
     * Wipes the local medication store AND cancels every registered alarm, so the
     * previous account's doses can never ring for whoever is signed in next.
     *
     * Order matters: the action queue is flushed FIRST, while the outgoing
     * session is still valid, because after this the credential is gone and any
     * un-synced Taken/Skip could never reach the server. The queue itself is then
     * left in place rather than deleted — a stranded action is recoverable, a
     * deleted one is not.
     */
    @PluginMethod
    fun clearSchedule(call: PluginCall) {
        scope.launch {
            val flushed = runCatching { ActionSync.flush(context) }.getOrDefault(0)

            AlarmScheduler.cancelAllKnown(context)
            ScheduleDatabase.getInstance(context).medicationDao().deleteAll()
            runCatching { ScheduleDatabase.getInstance(context).pendingSnoozeDao().clearAll() }

            val stranded = runCatching {
                ScheduleDatabase.getInstance(context).doseActionDao().allUnsynced().size
            }.getOrDefault(0)
            if (stranded > 0) {
                Log.w(
                    AlarmScheduler.TAG,
                    "clearSchedule: $stranded dose action(s) still unsynced and now have no session. " +
                        "Kept, not deleted — they retry if this account signs in again.",
                )
            }

            SessionStore.clearSession(context)
            Log.i(AlarmScheduler.TAG, "clearSchedule: local store wiped and all alarms cancelled")

            val result = JSObject()
            result.put("cleared", true)
            result.put("syncedBeforeClear", flushed)
            result.put("strandedActions", stranded)
            call.resolve(result)
        }
    }

    /**
     * `setSession({ accessToken, refreshToken, expiresAt, supabaseUrl,
     * supabaseAnonKey, userId })` — the webview hands over its Supabase session
     * so native can call RPCs as this user. Stored encrypted (see [SessionStore]).
     *
     * Also drains the action queue immediately: this is the moment a previously
     * un-syncable Taken/Skip becomes syncable, so it is the single most useful
     * place to retry.
     */
    @PluginMethod
    fun setSession(call: PluginCall) {
        val accessToken = call.getString("accessToken")
        val refreshToken = call.getString("refreshToken")
        val supabaseUrl = call.getString("supabaseUrl")
        val supabaseAnonKey = call.getString("supabaseAnonKey")

        if (accessToken.isNullOrBlank() || supabaseUrl.isNullOrBlank() || supabaseAnonKey.isNullOrBlank()) {
            call.reject("setSession requires accessToken, supabaseUrl and supabaseAnonKey")
            return
        }

        SessionStore.save(
            context = context,
            accessToken = accessToken,
            refreshToken = refreshToken ?: "",
            expiresAt = call.getInt("expiresAt")?.toLong() ?: 0L,
            supabaseUrl = supabaseUrl.trimEnd('/'),
            supabaseAnonKey = supabaseAnonKey,
            userId = call.getString("userId"),
        )

        scope.launch {
            val synced = runCatching { ActionSync.flush(context) }.getOrDefault(0)
            val result = JSObject()
            result.put("stored", true)
            result.put("syncedPendingActions", synced)
            call.resolve(result)
        }
    }

    /**
     * `getPendingActions()` — Taken/Skip/Snooze taps not yet accepted by the
     * server. Exists so the web UI can say "N actions syncing" instead of
     * silently disagreeing with the server for a while.
     */
    /**
     * Everything the web needs to tell the user whether alarms will actually
     * fire on THIS device (M3 OEM onboarding).
     *
     * Read-only and permission-free. The web owns the UI because in `server.url`
     * mode the deployed site *is* the app's interface — native's job here is only
     * to answer questions the webview cannot.
     */
    @PluginMethod
    fun getReliabilityStatus(call: PluginCall) {
        val result = JSObject()
        result.put("manufacturer", DeviceReliability.manufacturer())
        result.put("brand", DeviceReliability.brand())
        result.put("isAggressiveOem", DeviceReliability.isAggressiveOem())
        result.put("ignoringBatteryOptimizations", DeviceReliability.isIgnoringBatteryOptimizations(context))
        result.put("canScheduleExactAlarms", AlarmScheduler.canScheduleExact(context))
        result.put("notificationsEnabled", DeviceReliability.areNotificationsEnabled(context))
        result.put("canUseFullScreenIntent", DeviceReliability.canUseFullScreenIntent(context))
        result.put("hasAutostartSettings", DeviceReliability.hasAutostartSettings(context))
        call.resolve(result)
    }

    /**
     * Opens one of the settings screens the user must act on themselves. The app
     * cannot grant any of these — that is the whole point of them — so the most
     * it can do is remove the navigation guesswork.
     */
    @PluginMethod
    fun openReliabilitySetting(call: PluginCall) {
        val target = call.getString("target")
        if (target !in setOf("battery", "autostart", "notifications", "exactAlarms")) {
            call.reject("unknown reliability target: $target")
            return
        }
        // Walks an ordered chain and reports WHICH intent worked, so the web can
        // show written steps when nothing did — and so the candidate list can be
        // improved from real devices rather than from guesswork.
        val openedVia = DeviceReliability.open(context, target!!)
        call.resolve(
            JSObject()
                .put("opened", openedVia != null)
                .put("openedVia", openedVia),
        )
    }

    @PluginMethod
    fun getPendingActions(call: PluginCall) {
        scope.launch {
            val unsynced = ScheduleDatabase.getInstance(context).doseActionDao().allUnsynced()
            val arr = JSArray()
            unsynced.forEach { action ->
                arr.put(
                    JSObject().apply {
                        put("id", action.id)
                        put("medicationId", action.medicationId)
                        put("drugName", action.drugName)
                        put("scheduledFor", action.scheduledFor)
                        put("action", action.action)
                        put("recordedAt", action.recordedAt)
                        put("attempts", action.attempts)
                        put("syncError", action.syncError)
                    },
                )
            }
            val result = JSObject()
            result.put("actions", arr)
            call.resolve(result)
        }
    }

    /**
     * TEST HELPER (step 3) — fires a real alarm `seconds` from now through the
     * exact same AlarmManager path a real dose uses, so alarm timing and
     * delivery can be verified on a device without waiting for a real dose
     * time. Uses a synthetic negative medication id so [AlarmReceiver] knows
     * there is no row behind it and skips rescheduling.
     *
     * Remove once M2 is verified end to end; it is a debugging affordance, not
     * a product feature.
     */
    @PluginMethod
    fun scheduleTestAlarm(call: PluginCall) {
        val seconds = call.getInt("seconds") ?: 60
        val fireAt = Instant.now().plusSeconds(seconds.toLong())

        AlarmScheduler.scheduleAt(
            context = context,
            medicationId = -1L,
            drugName = "Test alarm",
            doseLabel = "Fired ${seconds}s after scheduling",
            fireAt = fireAt,
        )

        val result = JSObject()
        result.put("scheduledFor", fireAt.toString())
        result.put("canScheduleExactAlarms", AlarmScheduler.canScheduleExact(context))
        call.resolve(result)
    }

    /**
     * Debug-only for this step: lets you confirm from the webview's own
     * console (or a quick logcat print) what actually landed in the local
     * database, without needing Android Studio's Database Inspector.
     */
    @PluginMethod
    fun getSchedule(call: PluginCall) {
        scope.launch {
            val all = ScheduleDatabase.getInstance(context).medicationDao().getAll()
            val arr = JSArray()
            all.forEach { med ->
                val obj = JSObject()
                obj.put("id", med.id)
                obj.put("drugName", med.drugName)
                obj.put("reminderTimes", JSArray(med.reminderTimes))
                obj.put("timezone", med.timezone)
                obj.put("nextReminderAt", med.nextReminderAt)
                obj.put("active", med.active)
                arr.put(obj)
            }
            val result = JSObject()
            result.put("medications", arr)
            call.resolve(result)
        }
    }
}

/**
 * `JSONObject.optString(key, null)` is a Java-interop trap: the overload's
 * fallback is declared non-null, so Kotlin warns, and `optString(key)` alone
 * returns "" rather than null for a missing key. This maps absent / JSON-null /
 * empty all to a real Kotlin null, which is what [Medication]'s nullable
 * fields actually mean.
 */
private fun JSONObject.stringOrNull(key: String): String? =
    if (!has(key) || isNull(key)) null else optString(key).ifEmpty { null }
