package com.reminderhealth.app.schedule

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

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
@Database(entities = [Medication::class, DoseAction::class], version = 3, exportSchema = false)
@TypeConverters(ScheduleConverters::class)
abstract class ScheduleDatabase : RoomDatabase() {
    abstract fun medicationDao(): MedicationDao
    abstract fun doseActionDao(): DoseActionDao

    companion object {
        /**
         * v2 adds the family-voice-alarm columns (CLAUDE.md "Post-M2 features").
         *
         * A real migration rather than `fallbackToDestructiveMigration()`: the
         * store looks like a cache, but after a reboot the boot receiver
         * re-registers alarms FROM it, so wiping it on an app update would mean
         * no alarms until the user next opened the app. Not acceptable for a
         * medication reminder.
         */
        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE medications ADD COLUMN alarmAudioPath TEXT")
                db.execSQL("ALTER TABLE medications ADD COLUMN alarmPhotoPath TEXT")
            }
        }

        /**
         * v3 adds the offline action queue (step 6). Migration rather than a
         * destructive fallback for the same reason as v2 — and more urgently
         * here: this table holds Taken/Skip taps that have not reached the
         * server yet, so dropping it would silently lose a patient's answers.
         */
        private val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS dose_actions (
                        id TEXT NOT NULL PRIMARY KEY,
                        medicationId INTEGER NOT NULL,
                        drugName TEXT NOT NULL,
                        scheduledFor TEXT NOT NULL,
                        action TEXT NOT NULL,
                        recordedAt TEXT NOT NULL,
                        snoozeMinutes INTEGER,
                        synced INTEGER NOT NULL DEFAULT 0,
                        syncError TEXT,
                        attempts INTEGER NOT NULL DEFAULT 0
                    )
                    """.trimIndent(),
                )
            }
        }

        @Volatile
        private var INSTANCE: ScheduleDatabase? = null

        fun getInstance(context: Context): ScheduleDatabase =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    ScheduleDatabase::class.java,
                    "schedule.db",
                ).addMigrations(MIGRATION_1_2, MIGRATION_2_3).build().also { INSTANCE = it }
            }
    }
}
