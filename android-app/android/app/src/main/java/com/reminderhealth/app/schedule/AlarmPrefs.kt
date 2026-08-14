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
    private const val KEY_RING_SECONDS = "ringSeconds"

    /**
     * Ring-window bounds, mirroring the CHECK on `profiles.alarm_ring_seconds`.
     *
     * Duplicated deliberately rather than trusted from the payload: this value
     * drives a lit, ringing, vibrating screen on someone's bedside table, and the
     * device has to be safe against a bad sync as well as a bad form.
     */
    const val RING_SECONDS_MIN = 60
    const val RING_SECONDS_MAX = 300
    const val RING_SECONDS_DEFAULT = 60

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

    /**
     * How long EACH dose rings before the screen moves on to the next one.
     *
     * Per dose, not per screen: a handful of four at two minutes each is a screen
     * that can run for eight. That is why the setting's copy says "each medicine
     * rings this long" — the total is the user's arithmetic to do, and hiding it
     * would be the app being coy about a lit screen on a bedside table.
     *
     * Clamped on read as well as on write. A stored value can predate a change to
     * the bounds, and the read is the one that actually drives the timer.
     */
    fun ringSeconds(context: Context): Int =
        clampRingSeconds(prefs(context).getInt(KEY_RING_SECONDS, RING_SECONDS_DEFAULT))

    fun setRingSeconds(context: Context, seconds: Int) {
        prefs(context).edit().putInt(KEY_RING_SECONDS, clampRingSeconds(seconds)).apply()
    }

    fun clampRingSeconds(seconds: Int): Int = seconds.coerceIn(RING_SECONDS_MIN, RING_SECONDS_MAX)

    // -- ALARM MEDIA (see [AlarmMedia]) --------------------------------------
    //
    // Only the CHOICE lives here; the bytes live in app-private storage. Kept in
    // this file rather than in AlarmMedia so every alarm preference is in one
    // place — which is also the file that documents why none of them are in
    // SessionStore.

    private const val KEY_IMAGE_CHOICE = "imageChoice"
    private const val KEY_SOUND_CHOICE = "soundChoice"

    /** One of [AlarmMedia.BUNDLED]'s keys, `custom`, or `none`. Defaults to no backdrop. */
    fun imageChoice(context: Context): String =
        prefs(context).getString(KEY_IMAGE_CHOICE, AlarmMedia.IMAGE_NONE) ?: AlarmMedia.IMAGE_NONE

    fun setImageChoice(context: Context, choice: String) {
        prefs(context).edit().putString(KEY_IMAGE_CHOICE, choice).apply()
    }

    /** `default` (the system alarm tone) or `custom`. */
    fun soundChoice(context: Context): String =
        prefs(context).getString(KEY_SOUND_CHOICE, AlarmMedia.SOUND_DEFAULT) ?: AlarmMedia.SOUND_DEFAULT

    fun setSoundChoice(context: Context, choice: String) {
        prefs(context).edit().putString(KEY_SOUND_CHOICE, choice).apply()
    }
}
