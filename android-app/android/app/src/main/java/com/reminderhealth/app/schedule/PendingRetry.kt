package com.reminderhealth.app.schedule

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import org.json.JSONArray

/**
 * A retry ladder that has started and has rungs left to ring.
 *
 * **Why this needs a table**, and it is the same lesson [PendingSnooze] records:
 * a rung is a transient `AlarmManager` registration, Android drops every alarm
 * on shutdown, and [AlarmScheduler.rescheduleAll] rebuilds purely from
 * `reminder_times`. Without this row, rebooting mid-ladder would silently drop a
 * CRITICAL medication's remaining rungs — the device going quiet about exactly
 * the dose the whole feature exists to chase. That was called out as a must-fix
 * within the feature rather than a follow-up.
 *
 * **Why not columns on [Medication].** `medications` mirrors server state and is
 * REPLACED WHOLESALE on every `syncSchedule` (see [MedicationDao.replaceAll]),
 * which happens on app open and on every dashboard navigation. An in-flight
 * ladder is device-local truth no sync knows about, so keeping it there would
 * mean any sync mid-ladder wiped it. This table survives the replace.
 *
 * One row per medication, matching the alarm core's one-pending-alarm-per-
 * medication model.
 */
@Entity(tableName = "pending_retries")
data class PendingRetry(
    @PrimaryKey val medicationId: Long,
    /**
     * The ORIGINAL dose instant this ladder is chasing (ISO-8601 UTC) — the
     * dose's identity, never a rung's own fire time. Answering a rung resolves
     * THIS instant; getting it wrong makes the answer unsaveable
     * (`INVALID_SCHEDULED_TIME`), which is the bug the snooze split already paid
     * for once.
     */
    val doseAt: String,
    /**
     * Rungs not yet rung, as minute offsets from [doseAt], ascending, JSON-
     * encoded. The head is the next to fire. Empty is never stored — the row is
     * deleted instead, because "a ladder with nothing left" and "no ladder" are
     * the same state, and keeping both invites code that checks only one.
     *
     * Stored as TEXT rather than `List<Int>` deliberately: Room's converter
     * matching does not reliably distinguish `List<Int>` from `List<Int>?`, and
     * [ScheduleConverters] already owns the nullable one for [Medication.doseDays].
     * Encoding here keeps the column type obvious and the converters unambiguous.
     */
    val remainingOffsets: String,
) {
    fun offsets(): List<Int> = decode(remainingOffsets)

    companion object {
        fun encode(offsets: List<Int>): String = JSONArray(offsets).toString()

        fun decode(json: String): List<Int> {
            val arr = JSONArray(json)
            return (0 until arr.length()).map { arr.getInt(it) }
        }

        /**
         * A ladder row, or null when there is nothing left to ring — so callers
         * write `upsert(...)` or `clear(...)` from one decision instead of
         * remembering to special-case the empty list.
         */
        fun of(medicationId: Long, doseAt: String, offsets: List<Int>): PendingRetry? =
            if (offsets.isEmpty()) null
            else PendingRetry(medicationId, doseAt, encode(offsets))
    }
}

@Dao
interface PendingRetryDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(retry: PendingRetry)

    @Query("SELECT * FROM pending_retries WHERE medicationId = :medicationId")
    suspend fun get(medicationId: Long): PendingRetry?

    /** Every live ladder — what [AlarmScheduler.rescheduleAll] rebuilds from after a boot. */
    @Query("SELECT * FROM pending_retries")
    suspend fun getAll(): List<PendingRetry>

    /** The dose was answered, from any surface. Cancel the chain. */
    @Query("DELETE FROM pending_retries WHERE medicationId = :medicationId")
    suspend fun clear(medicationId: Long)

    /** Sign-out / account switch: a pending ladder belongs to the outgoing account. */
    @Query("DELETE FROM pending_retries")
    suspend fun clearAll()
}
