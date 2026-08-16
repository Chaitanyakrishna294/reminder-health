package com.reminderhealth.app.schedule

import android.content.Context
import android.content.res.Configuration
import java.util.Locale

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
    private const val KEY_LANGUAGE = "language"

    /**
     * The languages the app ships complete. Anything else falls back to English.
     *
     * An ALLOWLIST, not a passthrough of whatever the payload said. The bridge is
     * a channel from a webview we control today, but a value read straight into a
     * `Locale` decides what a patient reads at 3am — and an unknown tag would
     * silently resolve to the default resources, which is the right outcome but
     * for the wrong reason. Listing them makes "which languages does the alarm
     * speak" answerable from this file rather than from a `values-*` directory
     * listing. Keep in lockstep with `LOCALES` in web/src/lib/i18n/locales.ts.
     */
    val SUPPORTED_LANGUAGES = setOf("en", "hi", "te", "ta", "kn", "ml", "mr")

    const val LANGUAGE_DEFAULT = "en"

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

    // -- LANGUAGE ------------------------------------------------------------

    /**
     * The IN-APP language, mirrored from the web.
     *
     * **This exists because Android resource qualifiers follow the DEVICE locale,
     * and the device locale is not the choice the user made in this app.** A
     * patient whose phone is in English but who set the app to Telugu would get
     * `values/` — an English alarm — on the one screen that must work offline, at
     * speed, for the least technical person we have. `values-te/` alone does not
     * fix that; nothing consults it unless the *configuration* says Telugu, which
     * is what [localized] forces.
     *
     * Defaults to English, and an unrecognised tag falls back to English rather
     * than being stored: an alarm in a language nobody chose is worse than an
     * alarm in the language everything else already defaults to.
     */
    fun language(context: Context): String {
        val stored = prefs(context).getString(KEY_LANGUAGE, LANGUAGE_DEFAULT) ?: LANGUAGE_DEFAULT
        return if (stored in SUPPORTED_LANGUAGES) stored else LANGUAGE_DEFAULT
    }

    fun setLanguage(context: Context, language: String?) {
        // A null/blank field means "the web did not say", which must leave the last
        // known choice alone — same contract as ringSeconds. Only an explicit,
        // supported tag overwrites.
        val tag = language?.trim()?.lowercase()?.substringBefore('-') ?: return
        if (tag.isEmpty() || tag !in SUPPORTED_LANGUAGES) return
        prefs(context).edit().putString(KEY_LANGUAGE, tag).apply()
    }

    /**
     * A Context whose resources resolve in the app's chosen language.
     *
     * EVERY user-facing native string must be pulled through this — the alarm
     * screen, the notification actions, the retry rungs, the missed notice and the
     * water nudge. `context.getString(...)` on a raw Context reads the DEVICE
     * locale and will quietly disagree with the rest of the app.
     *
     * Note this is the frame only. Medication names come from the Room store as
     * the user typed them and are never passed through resources — the same
     * "translate the frame, never the content" rule the web side keeps.
     */
    fun localized(context: Context): Context {
        val locale = Locale.forLanguageTag(language(context))
        val config = Configuration(context.resources.configuration)
        config.setLocale(locale)
        return context.createConfigurationContext(config)
    }

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
