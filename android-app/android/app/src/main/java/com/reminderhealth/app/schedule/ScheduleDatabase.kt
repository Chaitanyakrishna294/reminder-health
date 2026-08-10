package com.reminderhealth.app.schedule

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters

/**
 * The on-device database — one file (`schedule.db`) living in the app's
 * private storage, invisible to other apps and to the webview. This is the
 * "device-side copy of the user's active medications" CLAUDE.md's Android
 * section describes: everything the alarm core needs to keep firing exact
 * alarms, entirely offline, with zero dependency on the webview once synced.
 *
 * `getInstance` is the standard Room pattern for "only ever open the
 * database once per process" — similar in spirit to reusing a single
 * Supabase client instance instead of creating a new one per call.
 */
@Database(entities = [Medication::class], version = 1, exportSchema = false)
@TypeConverters(ScheduleConverters::class)
abstract class ScheduleDatabase : RoomDatabase() {
    abstract fun medicationDao(): MedicationDao

    companion object {
        @Volatile
        private var INSTANCE: ScheduleDatabase? = null

        fun getInstance(context: Context): ScheduleDatabase =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    ScheduleDatabase::class.java,
                    "schedule.db",
                ).build().also { INSTANCE = it }
            }
    }
}
