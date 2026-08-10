package com.reminderhealth.app.schedule

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

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
                    dosage = m.optString("dosage", null),
                    dosageAmount = m.optDouble("dosageAmount", 1.0),
                    unitType = m.optString("unitType", null),
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
                    medicationReason = m.optString("medicationReason", null),
                )
            }
        } catch (e: Exception) {
            call.reject("syncSchedule payload parse error: ${e.message}")
            return
        }

        scope.launch {
            ScheduleDatabase.getInstance(context).medicationDao().replaceAll(medications)

            val result = JSObject()
            result.put("synced", medications.size)
            call.resolve(result)
        }
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
