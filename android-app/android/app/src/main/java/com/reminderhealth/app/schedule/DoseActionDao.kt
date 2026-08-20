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
     * A failure that says nothing about the ACTION — an expired or missing JWT.
     * Records the error but does NOT spend a retry.
     *
     * Paid for 2026-08-18: a dose answered on the device hit `resolve_reminder_event
     * HTTP 401 ... PGRST303 JWT expired`, and because an auth failure incremented
     * `attempts` exactly like a real rejection, WorkManager's backoff chain burned
     * all five against a token that could never work. The action was then excluded
     * from [pending] forever — a patient's recorded "I took it", lost to a token
     * lifetime. The ceiling exists to stop retrying doses the server will always
     * reject; an unauthenticated attempt is not evidence of that.
     */
    @Query("UPDATE dose_actions SET syncError = :error WHERE id = :id")
    suspend fun markAuthFailed(id: String, error: String?)

    /**
     * Give one action its retries back — for rows a dead token stranded under a
     * build that spent retries on 401s.
     *
     * Per-id ON PURPOSE rather than one bulk UPDATE with a `syncError LIKE`
     * filter: whether an error is auth-shaped is decided in exactly one place
     * ([ActionSync.isAuthFailure]), and expressing that a second time in SQL is
     * how the two drift apart. The caller reads [allUnsynced], filters with that
     * function, and calls this.
     *
     * Filtering matters. An unconditional reset would hand five fresh attempts to
     * a permanently-rejected dose (INVALID_SCHEDULED_TIME, MEDICATION_NOT_FOUND)
     * on every app open forever, re-reporting to Sentry each time it re-stranded.
     * The ceiling exists for exactly those.
     */
    @Query("UPDATE dose_actions SET attempts = 0 WHERE id = :id")
    suspend fun resetAttempts(id: String)

    /**
     * Housekeeping. Synced actions are kept briefly rather than deleted immediately
     * so the UI can show "synced" instead of a row vanishing mid-glance; the server
     * is the real record either way.
     */
    @Query("DELETE FROM dose_actions WHERE synced = 1 AND recordedAt < :olderThanIso")
    suspend fun pruneSynced(olderThanIso: String)
}
