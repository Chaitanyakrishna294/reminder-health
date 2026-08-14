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

    /**
     * `medications.priority_level` — "normal" | "important" | "critical".
     *
     * Added with the retry ladder (2026-08-14). It was deliberately NOT synced
     * before, because nothing native varied by it: the alarm rang once and the
     * server owned every escalation decision. The ladder is the first native
     * behaviour that differs by priority.
     */
    val priorityLevel: String? = null,

    /**
     * Retry-ladder override, or null to use the priority default — which is the
     * normal state. BOTH or NEITHER; a database CHECK rejects a half-set pair,
     * and [RetryLadder] treats either being null as "use the default".
     *
     * NOT to be confused with `medications.retry_count` on the server, which is
     * the BOT's send-retry counter and is not synced here at all. That name
     * collision cost a failed migration on 2026-08-14.
     */
    val retryLadderIntervalMinutes: Int? = null,
    val retryLadderCount: Int? = null,

    /**
     * Family voice alarms (see CLAUDE.md "Post-M2 features"). Absolute paths to
     * files ALREADY DOWNLOADED to local device storage — never remote URLs: the
     * alarm has to work in airplane mode, so nothing may be fetched at fire
     * time. Null (the default until that feature ships) means the alarm uses
     * the default tone and no photo.
     */
    val alarmAudioPath: String? = null,
    val alarmPhotoPath: String? = null,
)
