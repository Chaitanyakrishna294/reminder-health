package com.reminderhealth.app.schedule

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query

/**
 * A snooze that has been taken but whose re-prompt has not fired yet.
 *
 * **Why this needs a table at all.** A snooze used to be nothing but a transient
 * `AlarmManager` registration. Android drops every alarm on shutdown, and
 * [AlarmScheduler.rescheduleAll] rebuilds purely from `reminder_times` — so
 * rebooting between a snooze and its re-fire silently dropped the device's
 * re-prompt, and the dose jumped to its next scheduled occurrence (observed on
 * device 2026-08-11: med 137 snoozed at 16:00, phone rebooted, post-boot alarm
 * was the next day). The server still had the dose SNOOZED with
 * `retry_reminder_at` set so escalation was never at risk — but the device, which
 * is the surface the patient actually answers, went quiet.
 *
 * **Why a separate table rather than columns on [Medication].** `medications` is
 * a mirror of server state and is REPLACED WHOLESALE on every `syncSchedule`
 * (see [MedicationDao.replaceAll]) — which happens on app open and on every
 * dashboard navigation. Snooze state is device-local truth that no sync knows
 * about, so keeping it there would mean any sync during a snooze wiped it. This
 * table survives the replace.
 *
 * One row per medication, matching the alarm core's "one pending alarm per
 * medication" model.
 */
@Entity(tableName = "pending_snoozes")
data class PendingSnooze(
    @PrimaryKey val medicationId: Long,
    /** The ORIGINAL dose instant being deferred (ISO-8601 UTC) — the dose's identity. */
    val doseAt: String,
    /** When the device should re-ask (ISO-8601 UTC). */
    val fireAt: String,
)

@Dao
interface PendingSnoozeDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(snooze: PendingSnooze)

    @Query("SELECT * FROM pending_snoozes WHERE medicationId = :medicationId")
    suspend fun get(medicationId: Long): PendingSnooze?

    @Query("DELETE FROM pending_snoozes WHERE medicationId = :medicationId")
    suspend fun clear(medicationId: Long)

    /** Sign-out / account switch: a pending snooze belongs to the outgoing account. */
    @Query("DELETE FROM pending_snoozes")
    suspend fun clearAll()
}
