package com.reminderhealth.app.schedule

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * One row = one medication's schedule, mirrored from the server via
 * [ScheduleBridgePlugin.syncSchedule]. Field names and source columns match
 * `MedicationPayload` in android-app/BRIDGE_CONTRACT.md exactly.
 *
 * [reminderTimes] and [doseDays] are lists, which Room can't store directly
 * as columns — [ScheduleConverters] encodes/decodes them as JSON text.
 */
@Entity(tableName = "medications")
data class Medication(
    @PrimaryKey val id: Long,
    val drugName: String,
    val dosage: String?,
    val dosageAmount: Double,
    val unitType: String?,
    val reminderTimes: List<String>, // "HH:MM" wall-clock strings, e.g. ["08:00", "20:00"]
    val doseDays: List<Int>?, // 0=Sun..6=Sat; null = every day
    val timezone: String, // IANA tz, e.g. "Asia/Kolkata"
    val nextReminderAt: String, // ISO 8601 UTC — server-computed seed value
    val active: Boolean, // inactive medications get no alarms
    val medicationReason: String?,
)
