package com.reminderhealth.app.schedule

import android.content.Context
import java.time.LocalDate
import java.time.ZoneId

/**
 * The water feature's device-side state: the schedule, and today's count.
 *
 * Its own prefs file rather than a Room table, deliberately. This is the QUIET
 * TIER (CLAUDE.md): nothing escalates on it, no caregiver reads it, nothing is
 * recorded when a nudge is ignored. A counter and a handful of settings do not
 * need a migration, an entity and a DAO — and keeping it out of `schedule.db`
 * means a water bug can never take the alarm store down with it.
 */
object WaterPrefs {
    private const val FILE = "water_prefs"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_GOAL = "goalCups"
    private const val KEY_TIMES = "nudgeMinutes"
    private const val KEY_DAY = "countDay"
    private const val KEY_COUNT = "countCups"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun isEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_ENABLED, false)

    fun goalCups(context: Context): Int = prefs(context).getInt(KEY_GOAL, 0)

    /**
     * Minutes-from-midnight for each nudge, already stripped of dose clashes by
     * the web before it sent them. Stored as CSV: a list of small ints does not
     * justify JSON, and this file is read on a background worker tick.
     */
    fun nudgeMinutes(context: Context): List<Int> =
        prefs(context).getString(KEY_TIMES, "")
            ?.split(',')
            ?.mapNotNull { it.trim().toIntOrNull() }
            ?: emptyList()

    fun save(context: Context, enabled: Boolean, goalCups: Int, minutes: List<Int>) {
        prefs(context).edit()
            .putBoolean(KEY_ENABLED, enabled)
            .putInt(KEY_GOAL, goalCups)
            .putString(KEY_TIMES, minutes.joinToString(","))
            .apply()
    }

    /**
     * Today's cup count, and the day it belongs to.
     *
     * RESETS BY LOCAL DAY, checked on read rather than by a scheduled job: a
     * midnight worker just to zero a counter is a wake-up for nothing, and this
     * value is only ever read when something is already happening.
     */
    fun cupsToday(context: Context, zone: ZoneId = ZoneId.systemDefault()): Int {
        val p = prefs(context)
        val today = LocalDate.now(zone).toString()
        return if (p.getString(KEY_DAY, null) == today) p.getInt(KEY_COUNT, 0) else 0
    }

    /** @return the new count. */
    fun addCup(context: Context, zone: ZoneId = ZoneId.systemDefault()): Int {
        val next = (cupsToday(context, zone) + 1).coerceAtMost(60)
        prefs(context).edit()
            .putString(KEY_DAY, LocalDate.now(zone).toString())
            .putInt(KEY_COUNT, next)
            .apply()
        return next
    }

    /**
     * Take the web's count as the truth.
     *
     * Last write wins, NOT "larger wins" — the same rule the web sync uses, and
     * for the same reason: taking the larger number makes undo impossible by
     * resurrecting the count the user just corrected.
     */
    fun setCups(context: Context, cups: Int, zone: ZoneId = ZoneId.systemDefault()) {
        prefs(context).edit()
            .putString(KEY_DAY, LocalDate.now(zone).toString())
            .putInt(KEY_COUNT, cups.coerceIn(0, 60))
            .apply()
    }

    /** Sign-out / account switch: one person's hydration must not greet the next. */
    fun clear(context: Context) {
        prefs(context).edit().clear().apply()
    }
}
