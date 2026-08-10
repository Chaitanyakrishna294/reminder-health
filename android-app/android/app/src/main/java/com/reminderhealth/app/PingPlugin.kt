package com.reminderhealth.app

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * M1 bridge proof only — confirms the page loaded via server.url (the
 * deployed Vercel site) can round-trip through the native bridge. Not part
 * of the alarm core (M2); safe to delete once M1 is verified or once real
 * M2 plugins (syncSchedule, setSession, getPendingActions — see CLAUDE.md)
 * make it redundant. See android-app/README.md.
 */
@CapacitorPlugin(name = "Ping")
class PingPlugin : Plugin() {
    @PluginMethod
    fun ping(call: PluginCall) {
        val value = call.getString("value") ?: ""
        val ret = JSObject()
        ret.put("value", "pong: $value")
        call.resolve(ret)
    }
}
