package com.reminderhealth.app.schedule

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant

/**
 * Pushes queued [DoseAction]s to Supabase.
 *
 * Plain `HttpURLConnection` + `org.json` rather than adding a HTTP client or the
 * supabase-kt SDK: two POSTs to `/rest/v1/rpc/<fn>` with two headers is the whole
 * requirement, and the alarm core's value is that it has almost no dependencies
 * to break.
 *
 * Every failure is recoverable by design — the action stays queued and is retried
 * — because the alternative (dropping it) is losing a patient's answer.
 */
object ActionSync {
    private const val TIMEOUT_MS = 15_000

    /** Distinguishes device-originated resolutions in `reminder_events`. */
    private const val CHANNEL = "ANDROID_ALARM"

    /**
     * Drains the queue. Safe to call often and from anywhere — it no-ops without a
     * session or with nothing pending.
     *
     * @return how many actions synced successfully.
     */
    suspend fun flush(context: Context): Int {
        val dao = ScheduleDatabase.getInstance(context).doseActionDao()
        val pending = dao.pending()

        // Anything unsynced that pending() no longer returns has burned through its
        // retry ceiling and will never be attempted again. It is still in the table,
        // but nothing looks at it — so without this line a patient's recorded "I took
        // it" disappears in total silence, on both the device and the server. Log it
        // with the last error, since that error is the actual bug to go fix.
        val stranded = dao.allUnsynced().filter { action -> pending.none { it.id == action.id } }
        if (stranded.isNotEmpty()) {
            // A patient's recorded answer that will never reach the server. The
            // count and the last error travel; the drug name does not.
            Crash.report(
                "dose actions stranded after ${stranded.size} exhausted retries: " +
                    stranded.first().syncError?.take(200),
                stranded.first().medicationId,
            )
            Log.e(
                AlarmScheduler.TAG,
                "STRANDED: ${stranded.size} dose action(s) exhausted their retries and will NOT be " +
                    "sent — these answers exist only on this device: " +
                    stranded.joinToString("; ") { action ->
                        "${action.action} med ${action.medicationId} (${action.drugName}) " +
                            "scheduled ${action.scheduledFor} last error: ${action.syncError}"
                    },
            )
        }

        if (pending.isEmpty()) return 0

        val url = SessionStore.supabaseUrl(context)
        val anonKey = SessionStore.anonKey(context)
        val token = SessionStore.accessToken(context)

        if (url.isNullOrBlank() || anonKey.isNullOrBlank() || token.isNullOrBlank()) {
            Log.i(
                AlarmScheduler.TAG,
                "${pending.size} action(s) queued but no session yet — they stay queued until the " +
                    "app is opened and setSession runs. Nothing is lost.",
            )
            return 0
        }

        // Deliberately NOT bailing out when the stored token looks expired: the
        // queue is more valuable than the guess. A 401 marks a single attempt
        // failed and the action is retried after the next setSession, whereas
        // refusing to try would strand actions on nothing more than clock skew.
        if (SessionStore.isExpired(context, Instant.now().epochSecond)) {
            Log.w(AlarmScheduler.TAG, "stored access token looks expired; attempting sync anyway")
        }

        var synced = 0
        for (action in pending) {
            val result = runCatching { post(url, anonKey, token, action) }
                .getOrElse { Result.failure(it) }

            result.fold(
                onSuccess = {
                    dao.markSynced(action.id)
                    synced++
                    Log.i(
                        AlarmScheduler.TAG,
                        "synced ${action.action} for med ${action.medicationId} (${action.drugName}) " +
                            "scheduled ${action.scheduledFor}",
                    )
                },
                onFailure = { error ->
                    dao.markFailed(action.id, error.message)
                    Log.w(
                        AlarmScheduler.TAG,
                        "sync failed for ${action.action} med ${action.medicationId} " +
                            "(attempt ${action.attempts + 1}): ${error.message}",
                    )
                },
            )
        }

        // Keep a short tail of synced rows so the UI can show "synced" rather than
        // having a row vanish; the server is the record of truth regardless.
        runCatching {
            dao.pruneSynced(Instant.now().minusSeconds(7 * 24 * 3600).toString())
        }

        return synced
    }

    /**
     * One RPC call. Snooze goes to `snooze_reminder_event`; Taken/Skip go to
     * `resolve_reminder_event` with `p_action` sent VERBATIM ('TAKEN' / 'SKIP') —
     * that function treats anything that isn't the literal 'TAKEN' as a skip, so
     * a typo here would silently record the wrong outcome.
     */
    private fun post(
        baseUrl: String,
        anonKey: String,
        token: String,
        action: DoseAction,
    ): Result<Unit> {
        val isSnooze = action.action == DoseAction.ACTION_SNOOZE
        val fn = if (isSnooze) "snooze_reminder_event" else "resolve_reminder_event"

        val body = JSONObject().apply {
            put("p_medication_id", action.medicationId)
            put("p_scheduled_for", action.scheduledFor)
            if (isSnooze) {
                put("p_snooze_minutes", action.snoozeMinutes ?: AlarmActivity.SNOOZE_MINUTES)
                put("p_resolution_channel", CHANNEL)
            } else {
                // null: the alarm carries no reminder_events id, so the RPC resolves
                // by (medication_id, scheduled_for) instead. Supported by design.
                put("p_event_id", JSONObject.NULL)
                put("p_action", action.action)
                put("p_actor_role", "PATIENT")
                put("p_resolution_channel", CHANNEL)
            }
        }

        val connection = (URL("$baseUrl/rest/v1/rpc/$fn").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = TIMEOUT_MS
            readTimeout = TIMEOUT_MS
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("apikey", anonKey)
            setRequestProperty("Authorization", "Bearer $token")
        }

        return try {
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = connection.responseCode
            if (code in 200..299) {
                Result.success(Unit)
            } else {
                val detail = connection.errorStream
                    ?.bufferedReader()
                    ?.use(BufferedReader::readText)
                    ?.take(300)
                Result.failure(IllegalStateException("$fn HTTP $code: $detail"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        } finally {
            connection.disconnect()
        }
    }
}
