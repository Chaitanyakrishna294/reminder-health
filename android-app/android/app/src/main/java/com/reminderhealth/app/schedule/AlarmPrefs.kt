package com.reminderhealth.app.schedule

import android.content.Context

/**
 * The handful of webview settings the ALARM needs to know, mirrored natively.
 *
 * The alarm screen is Kotlin and must work at 3am with no network and without
 * the webview ever starting, so it cannot read anything the web keeps in
 * `localStorage` or in `profiles`. Anything that changes how a dose is presented
 * therefore has to cross the bridge and be stored here — the same argument
 * BRIDGE_CONTRACT.md already makes for the planned `language` field.
 *
 * **Plain SharedPreferences, not [SessionStore].** These are presentation
 * preferences, not credentials, and `SessionStore` is wiped on sign-out. Wiping
 * "this person needs the simplified screen" at sign-out would reset exactly the
 * person least able to put it back.
 */
object AlarmPrefs {
    private const val FILE = "alarm_prefs"
    private const val KEY_ELDERLY = "elderly"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /**
     * Elderly mode — CLAUDE.md's third density, mirrored for the alarm screen.
     *
     * The one behaviour it changes here is ONE QUESTION AT A TIME: a coalesced
     * handful is presented one dose at a time instead of as a list. The doses are
     * all still outstanding; only the presentation differs, which is the same
     * split the web's `ElderlyToday` keeps.
     *
     * Defaults to false, so an APK newer than the deployed web (or a device that
     * has not synced since install) gets the standard screen rather than a
     * simplified one nobody asked for.
     */
    fun isElderly(context: Context): Boolean = prefs(context).getBoolean(KEY_ELDERLY, false)

    fun setElderly(context: Context, elderly: Boolean) {
        prefs(context).edit().putBoolean(KEY_ELDERLY, elderly).apply()
    }
}
