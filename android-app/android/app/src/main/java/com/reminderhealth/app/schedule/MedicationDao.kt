package com.reminderhealth.app.schedule

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

/**
 * Data-access layer for the local schedule store. `suspend` marks these as
 * async (Kotlin's version of an `async function`) — Room requires DB work to
 * happen off the main/UI thread, same reason you wouldn't block a React
 * render on a network call.
 */
@Dao
interface MedicationDao {
    @Query("SELECT * FROM medications")
    suspend fun getAll(): List<Medication>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(medications: List<Medication>)

    @Query("DELETE FROM medications")
    suspend fun deleteAll()

    /**
     * [ScheduleBridgePlugin.syncSchedule]'s contract (BRIDGE_CONTRACT.md):
     * REPLACE the whole store, not a diff. `@Transaction` makes the clear +
     * re-insert atomic, so nothing ever reads a half-empty table in between.
     */
    @Transaction
    suspend fun replaceAll(medications: List<Medication>) {
        deleteAll()
        insertAll(medications)
    }
}
