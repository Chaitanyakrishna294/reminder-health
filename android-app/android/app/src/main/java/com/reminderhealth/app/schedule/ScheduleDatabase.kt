package com.reminderhealth.app.schedule

import android.content.Context
import android.util.Log
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import net.zetetic.database.sqlcipher.SupportOpenHelperFactory
import java.io.File

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
@Database(
    entities = [Medication::class, DoseAction::class, PendingSnooze::class],
    version = 4,
    exportSchema = false,
)
@TypeConverters(ScheduleConverters::class)
abstract class ScheduleDatabase : RoomDatabase() {
    abstract fun medicationDao(): MedicationDao
    abstract fun doseActionDao(): DoseActionDao
    abstract fun pendingSnoozeDao(): PendingSnoozeDao

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

        /**
         * v4 persists in-flight snoozes so a reboot cannot drop the device's
         * re-prompt (see [PendingSnooze] for the failure it fixes). Same
         * migrate-don't-drop reasoning as v2/v3: the boot receiver rebuilds
         * alarms from this database, so a destructive fallback here would be a
         * silent gap in someone's reminders.
         */
        private val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS pending_snoozes (
                        medicationId INTEGER NOT NULL PRIMARY KEY,
                        doseAt TEXT NOT NULL,
                        fireAt TEXT NOT NULL
                    )
                    """.trimIndent(),
                )
            }
        }

        private const val DB_NAME = "schedule.db"

        /** Where the encrypted copy is built before it replaces [DB_NAME]. */
        private const val STAGING_NAME = "schedule-encrypting.db"

        @Volatile
        private var INSTANCE: ScheduleDatabase? = null

        fun getInstance(context: Context): ScheduleDatabase =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: open(context.applicationContext).also { INSTANCE = it }
            }

        /**
         * Opens the encrypted store, and **never throws** — this is called from
         * the alarm receiver and the boot receiver, where an exception means no
         * medication reminders at all. An empty store that refills on the next
         * sync is a bad day; a crash loop in the alarm core is a patient missing
         * doses with no indication anything is wrong.
         */
        private fun open(context: Context): ScheduleDatabase {
            val dbFile = context.getDatabasePath(DB_NAME)

            // The native library first. If it is missing, SQLCipher cannot be used
            // at all — but that is an ENVIRONMENT problem, not a corrupt database,
            // and it must never reach the destructive recovery path below. Deleting
            // a patient's schedule because an .so failed to load would be a
            // self-inflicted outage.
            val cipherAvailable = runCatching { System.loadLibrary("sqlcipher") }
                .onFailure { Log.e(AlarmScheduler.TAG, "libsqlcipher.so failed to load", it) }
                .isSuccess

            val passphrase = if (cipherAvailable) DatabaseKeyStore.getOrCreate(context) else null

            if (passphrase == null) {
                // Encrypting with a key we cannot store would be worse than not
                // encrypting: unreadable next launch, then wiped by recovery. Run
                // unencrypted, and say so plainly rather than imply a protection
                // that is not there.
                Log.e(
                    AlarmScheduler.TAG,
                    "ENCRYPTION UNAVAILABLE — schedule.db stays UNENCRYPTED on this device " +
                        "(cipher=$cipherAvailable, key=${passphrase != null}). Reminders keep working; " +
                        "medication names and times are readable to anyone with filesystem access.",
                )
                return openPlainOrRecover(context, dbFile)
            }

            if (dbFile.exists() && ScheduleDatabaseCrypto.isPlaintext(dbFile) &&
                !convertPlaintextToEncrypted(context, dbFile, passphrase)
            ) {
                Log.e(AlarmScheduler.TAG, "encryption conversion failed; opening the store as it stands")
                return openPlainOrRecover(context, dbFile)
            }

            return runCatching { buildEncrypted(context, passphrase).also { it.probe() } }
                .getOrElse { error ->
                    // Genuinely unreadable: a rotated/lost Keystore key (device
                    // restore is the usual cause) or a corrupt file. The server is
                    // the record of truth for medications, so discarding and
                    // re-syncing recovers everything except unsynced dose actions.
                    Log.e(
                        AlarmScheduler.TAG,
                        "encrypted store could NOT be opened — discarding it and starting clean. " +
                            "Medications refill from the server on the next app open; any dose actions " +
                            "that had not yet synced are lost with it.",
                        error,
                    )
                    ScheduleDatabaseCrypto.deleteStore(dbFile)
                    DatabaseKeyStore.reset(context)
                    val freshKey = DatabaseKeyStore.getOrCreate(context)
                    if (freshKey == null) openPlainOrRecover(context, dbFile)
                    else runCatching { buildEncrypted(context, freshKey).also { it.probe() } }
                        .getOrElse { openPlainOrRecover(context, dbFile) }
                }
        }

        /**
         * Unencrypted open, with the same never-throw guarantee.
         *
         * Reaching here with a file that is ALREADY encrypted (cipher unavailable
         * on a device that previously had it) means Room sees bytes that are not
         * SQLite and throws — which is exactly the alarm-core crash this whole
         * path exists to prevent. So probe, and only then discard.
         */
        private fun openPlainOrRecover(context: Context, dbFile: File): ScheduleDatabase =
            runCatching { buildPlaintext(context).also { it.probe() } }
                .getOrElse { error ->
                    Log.e(
                        AlarmScheduler.TAG,
                        "store is unreadable unencrypted (it is most likely still encrypted and the " +
                            "key is gone) — discarding it so reminders can resume after the next sync",
                        error,
                    )
                    ScheduleDatabaseCrypto.deleteStore(dbFile)
                    buildPlaintext(context)
                }

        /**
         * Copies a plaintext store into a new encrypted one and swaps it into
         * place, preserving every medication, pending snooze and queued dose
         * action. Without this the switch to SQLCipher would look like corruption
         * and the recovery path would wipe the lot — including a patient's
         * recorded "I took it" that had not yet reached the server.
         *
         * Row-by-row through Room rather than SQLCipher's `sqlcipher_export()`:
         * that recipe's ATTACH silently failed on device (see
         * [ScheduleDatabaseCrypto]). The dataset is a few dozen rows, and Room's
         * own migrations bring the old file up to the current schema on open, so
         * this also cannot skip a schema step.
         *
         * The plaintext file is deleted only AFTER the encrypted copy is written
         * and closed, so a process death mid-conversion leaves the original
         * intact and the next launch simply retries.
         */
        private fun convertPlaintextToEncrypted(
            context: Context,
            dbFile: File,
            passphrase: String,
        ): Boolean = runCatching {
            Log.i(
                AlarmScheduler.TAG,
                "schedule.db is PLAINTEXT — converting to an encrypted store " +
                    "(${dbFile.length()} bytes); medications, pending snoozes and queued dose " +
                    "actions are all carried across",
            )

            val staging = context.getDatabasePath(STAGING_NAME)
            ScheduleDatabaseCrypto.deleteStore(staging)

            // runBlocking: the DAOs are suspend, this runs once, and every caller
            // of getInstance is already off the main thread (alarm/boot receivers
            // and the plugin's IO scope).
            kotlinx.coroutines.runBlocking {
                val plain = builder(context, DB_NAME).build()
                val medications = plain.medicationDao().getAll()
                val actions = plain.doseActionDao().allUnsynced()
                val snoozes = medications.mapNotNull { plain.pendingSnoozeDao().get(it.id) }
                plain.close()

                val encrypted = builder(context, STAGING_NAME)
                    .openHelperFactory(SupportOpenHelperFactory(passphrase.toByteArray(Charsets.UTF_8)))
                    .build()
                encrypted.medicationDao().insertAll(medications)
                actions.forEach { encrypted.doseActionDao().insert(it) }
                snoozes.forEach { encrypted.pendingSnoozeDao().upsert(it) }
                encrypted.close()

                Log.i(
                    AlarmScheduler.TAG,
                    "carried across ${medications.size} medication(s), ${actions.size} unsynced " +
                        "dose action(s), ${snoozes.size} pending snooze(s)",
                )
            }

            ScheduleDatabaseCrypto.deleteStore(dbFile)
            if (!ScheduleDatabaseCrypto.moveStore(staging, dbFile)) {
                error("could not move the encrypted store into place")
            }
            Log.i(AlarmScheduler.TAG, "ENCRYPTED-AT-REST conversion complete")
            true
        }.getOrElse { e ->
            Log.e(AlarmScheduler.TAG, "failed to convert schedule.db to an encrypted store", e)
            runCatching { ScheduleDatabaseCrypto.deleteStore(context.getDatabasePath(STAGING_NAME)) }
            false
        }

        private fun builder(context: Context, name: String) = Room.databaseBuilder(
            context, ScheduleDatabase::class.java, name,
        ).addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4)

        private fun builder(context: Context) = builder(context, DB_NAME)

        private fun buildEncrypted(context: Context, passphrase: String): ScheduleDatabase =
            builder(context)
                // The SAME bytes the conversion used as its SQL-literal passphrase —
                // see DatabaseKeyStore.getOrCreate for why this must be the hex text
                // rather than the raw key bytes.
                .openHelperFactory(SupportOpenHelperFactory(passphrase.toByteArray(Charsets.UTF_8)))
                .build()

        private fun buildPlaintext(context: Context): ScheduleDatabase = builder(context).build()

        /**
         * Forces the file open now. Room opens lazily, so without this a bad
         * passphrase would surface as an exception inside whichever alarm or boot
         * receiver happened to query first — far from anything that could recover.
         */
        private fun ScheduleDatabase.probe() {
            openHelper.readableDatabase.version
        }
    }
}
