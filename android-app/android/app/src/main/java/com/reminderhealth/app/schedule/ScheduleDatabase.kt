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
@Database(entities = [Medication::class], version = 2, exportSchema = false)
@TypeConverters(ScheduleConverters::class)
abstract class ScheduleDatabase : RoomDatabase() {
    abstract fun medicationDao(): MedicationDao

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

        @Volatile
        private var INSTANCE: ScheduleDatabase? = null

        fun getInstance(context: Context): ScheduleDatabase =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    ScheduleDatabase::class.java,
                    "schedule.db",
                ).addMigrations(MIGRATION_1_2).build().also { INSTANCE = it }
            }
    }
}
