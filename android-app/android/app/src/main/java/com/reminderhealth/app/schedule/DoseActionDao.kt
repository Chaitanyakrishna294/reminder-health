package com.reminderhealth.app.schedule

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface DoseActionDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(action: DoseAction)

    /**
     * Unsynced actions, oldest first, with a retry ceiling.
     *
     * The cap matters: `resolve_reminder_event` permanently rejects some doses by
     * design (INVALID_SCHEDULED_TIME once a schedule is edited, MEDICATION_NOT_FOUND
     * after deletion — see WORK_LEDGER's open items). Without a ceiling those would
     * be retried on every sync forever.
     */
    @Query("SELECT * FROM dose_actions WHERE synced = 0 AND attempts < :maxAttempts ORDER BY recordedAt ASC")
    suspend fun pending(maxAttempts: Int = 5): List<DoseAction>

    /** Everything still unsynced, retry-exhausted included — what the UI should surface. */
    @Query("SELECT * FROM dose_actions WHERE synced = 0 ORDER BY recordedAt ASC")
    suspend fun allUnsynced(): List<DoseAction>

    /**
     * Medications already answered for one exact dose instant — the coalesced
     * alarm screen's "who is still waiting" test.
     *
     * NOT filtered on `synced`: a dose answered offline is answered. Waiting for
     * a sync before believing the patient would re-ask them for the dose they
     * just took, which is the one thing this screen must never do.
     *
     * SNOOZE is excluded deliberately — a snooze defers the question, it does not
     * answer it, so a snoozed dose is still outstanding.
     */
    @Query("SELECT medicationId FROM dose_actions WHERE scheduledFor = :scheduledFor AND action != 'SNOOZE'")
    suspend fun answeredMedicationIdsAt(scheduledFor: String): List<Long>

    @Query("UPDATE dose_actions SET synced = 1, syncError = NULL WHERE id = :id")
    suspend fun markSynced(id: String)

    @Query("UPDATE dose_actions SET attempts = attempts + 1, syncError = :error WHERE id = :id")
    suspend fun markFailed(id: String, error: String?)

    /**
     * Housekeeping. Synced actions are kept briefly rather than deleted immediately
     * so the UI can show "synced" instead of a row vanishing mid-glance; the server
     * is the real record either way.
     */
    @Query("DELETE FROM dose_actions WHERE synced = 1 AND recordedAt < :olderThanIso")
    suspend fun pruneSynced(olderThanIso: String)
}
