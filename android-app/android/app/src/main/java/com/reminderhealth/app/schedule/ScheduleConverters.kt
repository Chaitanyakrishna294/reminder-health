package com.reminderhealth.app.schedule

import androidx.room.TypeConverter
import org.json.JSONArray

/**
 * Room only stores flat columns (text/number/etc.) — these convert
 * [Medication.reminderTimes]/[Medication.doseDays] to/from a single
 * JSON-encoded TEXT column apiece. Room calls these automatically; nothing
 * else in the app needs to.
 */
class ScheduleConverters {
    @TypeConverter
    fun fromStringList(value: List<String>): String = JSONArray(value).toString()

    @TypeConverter
    fun toStringList(value: String): List<String> {
        val arr = JSONArray(value)
        return (0 until arr.length()).map { arr.getString(it) }
    }

    @TypeConverter
    fun fromIntListOrNull(value: List<Int>?): String? = value?.let { JSONArray(it).toString() }

    @TypeConverter
    fun toIntListOrNull(value: String?): List<Int>? {
        if (value == null) return null
        val arr = JSONArray(value)
        return (0 until arr.length()).map { arr.getInt(it) }
    }
}
