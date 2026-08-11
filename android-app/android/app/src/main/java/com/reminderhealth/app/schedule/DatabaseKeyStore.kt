package com.reminderhealth.app.schedule

import android.content.Context
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.SecureRandom

/**
 * The passphrase for the encrypted `schedule.db`.
 *
 * Held in its own EncryptedSharedPreferences file, **deliberately separate from
 * [SessionStore]** — that one is wiped on sign-out, and wiping the database key
 * on sign-out would make the store unreadable rather than merely empty. The key
 * outlives sessions; the DATA is what `clearSchedule()` removes.
 *
 * The key itself is protected by the Android Keystore (hardware-backed where the
 * device supports it), so it never exists in plaintext on disk. That is what
 * makes encrypting the database worth anything: a key stored next to the data in
 * the clear would only inconvenience an attacker.
 */
object DatabaseKeyStore {
    private const val PREFS_FILE = "schedule_db_key"
    private const val KEY_PASSPHRASE = "passphrase"

    /** 256 bits of entropy, rendered as 64 hex characters. */
    private const val KEY_BYTES = 32

    /**
     * The existing passphrase, generating and persisting one on first call.
     *
     * **A hex STRING, not raw bytes, and that matters.** SQLCipher derives a key
     * from a passphrase, and the two places this value is used must agree on what
     * the passphrase *is*: `ATTACH ... KEY 'abc123'` uses the literal text, while
     * Room's `SupportOpenHelperFactory(byte[])` uses the bytes it is handed. Feed
     * one raw bytes and the other their hex rendering and you get two different
     * keys — a database that converts successfully and then cannot be opened.
     * Hex is used rather than base64 because it can never contain a character
     * that needs escaping inside a SQL string literal.
     *
     * Returns null only if the Android Keystore itself is unusable — which does
     * happen: keystore corruption after a factory-reset-restore, or an OEM ROM
     * bug, are the classic causes. Callers must treat null as "recover", never as
     * "crash": see [ScheduleDatabase.getInstance].
     */
    fun getOrCreate(context: Context): String? {
        val prefs = prefs(context) ?: return null

        prefs.getString(KEY_PASSPHRASE, null)?.let { return it }

        val bytes = ByteArray(KEY_BYTES).also { SecureRandom().nextBytes(it) }
        val fresh = bytes.joinToString("") { "%02x".format(it) }
        val persisted = runCatching {
            prefs.edit()
                .putString(KEY_PASSPHRASE, fresh)
                .commit()  // commit, not apply: if this key is lost the data is unreadable
        }.getOrDefault(false)

        if (!persisted) {
            // Returning the key anyway would encrypt the database with something
            // that is not written down — unreadable on next launch, and the
            // recovery path would wipe it. Failing here keeps the old store intact.
            Log.e(AlarmScheduler.TAG, "could not persist the database key; refusing to use it")
            return null
        }

        Log.i(AlarmScheduler.TAG, "generated a new encrypted-store passphrase")
        return fresh
    }

    /** Only for the unreadable-store recovery path — throws the old key away. */
    fun reset(context: Context) {
        runCatching { prefs(context)?.edit()?.remove(KEY_PASSPHRASE)?.commit() }
    }

    private fun prefs(context: Context) = runCatching {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            PREFS_FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }.onFailure {
        Log.e(AlarmScheduler.TAG, "Android Keystore unavailable; cannot reach the database key", it)
    }.getOrNull()
}
