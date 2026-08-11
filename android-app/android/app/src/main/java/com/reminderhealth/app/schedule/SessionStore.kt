package com.reminderhealth.app.schedule

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * The Supabase session handed over by the webview (`setSession`), so native can
 * call RPCs as the signed-in user.
 *
 * Encrypted at rest via [EncryptedSharedPreferences] — CLAUDE.md requires
 * on-device encryption for anything sensitive, and an access token is a bearer
 * credential for a health record.
 *
 * The Supabase URL and **anon** key come through the same call rather than being
 * hardcoded here: one source of truth (the web's existing `NEXT_PUBLIC_*` env),
 * nothing extra committed to the repo. The service-role key must never reach
 * this class — RLS is the only real defence once the app is decompilable.
 *
 * Also stores the owning user id, which is what lets the schedule store refuse a
 * wipe from a different account (see [ownerUserId]).
 */
object SessionStore {
    private const val FILE = "reminderhealth_session"
    private const val KEY_ACCESS = "accessToken"
    private const val KEY_REFRESH = "refreshToken"
    private const val KEY_EXPIRES = "expiresAt"
    private const val KEY_URL = "supabaseUrl"
    private const val KEY_ANON = "supabaseAnonKey"
    private const val KEY_USER = "userId"

    private fun prefs(context: Context): SharedPreferences? = runCatching {
        val masterKey = MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context.applicationContext,
            FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }.onFailure {
        Log.e(AlarmScheduler.TAG, "could not open encrypted session store", it)
    }.getOrNull()

    fun save(
        context: Context,
        accessToken: String,
        refreshToken: String,
        expiresAt: Long,
        supabaseUrl: String,
        supabaseAnonKey: String,
        userId: String?,
    ) {
        prefs(context)?.edit()
            ?.putString(KEY_ACCESS, accessToken)
            ?.putString(KEY_REFRESH, refreshToken)
            ?.putLong(KEY_EXPIRES, expiresAt)
            ?.putString(KEY_URL, supabaseUrl)
            ?.putString(KEY_ANON, supabaseAnonKey)
            ?.putString(KEY_USER, userId)
            ?.apply()
    }

    fun accessToken(context: Context): String? = prefs(context)?.getString(KEY_ACCESS, null)
    fun supabaseUrl(context: Context): String? = prefs(context)?.getString(KEY_URL, null)
    fun anonKey(context: Context): String? = prefs(context)?.getString(KEY_ANON, null)

    /**
     * Which account populated the local stores. Guest-first usage makes this
     * load-bearing: every "Try without an account" tap creates a NEW anonymous
     * user, so without an identity check a fresh guest's empty medication list
     * would wipe a real patient's alarms.
     */
    fun ownerUserId(context: Context): String? = prefs(context)?.getString(KEY_USER, null)

    /** True when the token is absent or past its expiry (60s of slack for clock skew). */
    fun isExpired(context: Context, nowEpochSeconds: Long): Boolean {
        val p = prefs(context) ?: return true
        if (p.getString(KEY_ACCESS, null).isNullOrBlank()) return true
        val expiresAt = p.getLong(KEY_EXPIRES, 0L)
        return expiresAt <= 0L || nowEpochSeconds >= (expiresAt - 60L)
    }

    fun hasSession(context: Context): Boolean =
        !prefs(context)?.getString(KEY_ACCESS, null).isNullOrBlank()

    /** Stamps which account owns the local stores, without touching the tokens. */
    fun setOwnerUserId(context: Context, userId: String?) {
        prefs(context)?.edit()?.putString(KEY_USER, userId)?.apply()
    }

    /**
     * Forgets the credential on logout. The Supabase URL and anon key are kept:
     * they are not secrets, and keeping them lets a queued action still be
     * addressed to the right project if a session returns.
     */
    fun clearSession(context: Context) {
        prefs(context)?.edit()
            ?.remove(KEY_ACCESS)
            ?.remove(KEY_REFRESH)
            ?.remove(KEY_EXPIRES)
            ?.remove(KEY_USER)
            ?.apply()
        Log.i(AlarmScheduler.TAG, "session cleared (tokens and owner forgotten)")
    }
}
