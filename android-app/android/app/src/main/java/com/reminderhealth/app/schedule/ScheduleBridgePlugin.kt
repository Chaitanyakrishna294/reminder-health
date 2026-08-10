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

        scope.launch {
            val dao = ScheduleDatabase.getInstance(context).medicationDao()

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
