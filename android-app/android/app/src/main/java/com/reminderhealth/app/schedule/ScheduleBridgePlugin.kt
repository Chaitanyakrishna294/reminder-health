package com.reminderhealth.app.schedule

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Instant

/**
 * The webview<->native bridge from BRIDGE_CONTRACT.md. This M2 step wires
 * syncSchedule only (plus a debug getSchedule to confirm it round-tripped) —
 * setSession and the offline action queue come in a later step.
 *
 * Same shape as M1's PingPlugin (now deleted, superseded by this):
 * `@CapacitorPlugin` names it for JS as `window.Capacitor.Plugins.
 * ScheduleBridge`, each `@PluginMethod` is one callable function, and
 * `call.resolve(...)` / `call.reject(...)` are how a promise on the JS side
 * settles.
 */
@CapacitorPlugin(name = "ScheduleBridge")
class ScheduleBridgePlugin : Plugin() {
    // A background scope for DB work, so it never blocks the UI thread —
    // Kotlin coroutines are the rough equivalent of async/await in JS.
    private val scope = CoroutineScope(Dispatchers.IO)

    /**
     * JS calls this as `ScheduleBridge.syncSchedule({ medications })` — a
     * single options object is Capacitor's calling convention, which is why
     * the array arrives wrapped under the "medications" key rather than as
     * a bare positional argument.
     */
    @PluginMethod
    fun syncSchedule(call: PluginCall) {
        val medicationsArray = call.getArray("medications")
        if (medicationsArray == null) {
            call.reject("syncSchedule requires a 'medications' array")
            return
        }

        val medications = try {
            (0 until medicationsArray.length()).map { i ->
                val m = medicationsArray.getJSONObject(i)
                Medication(
                    id = m.getLong("id"),
                    drugName = m.getString("drugName"),
                    dosage = m.stringOrNull("dosage"),
                    dosageAmount = m.optDouble("dosageAmount", 1.0),
                    unitType = m.stringOrNull("unitType"),
                    reminderTimes = m.getJSONArray("reminderTimes").let { arr ->
                        (0 until arr.length()).map { arr.getString(it) }
                    },
                    doseDays = if (m.isNull("doseDays")) {
                        null
                    } else {
                        m.getJSONArray("doseDays").let { arr -> (0 until arr.length()).map { arr.getInt(it) } }
                    },
                    timezone = m.getString("timezone"),
                    nextReminderAt = m.getString("nextReminderAt"),
                    active = m.getBoolean("active"),
                    medicationReason = m.stringOrNull("medicationReason"),
                    // Retry ladder (BRIDGE_CONTRACT.md section 0). All three are
                    // tolerated as absent so an APK newer than the deployed web
                    // still syncs -- server.url means the two halves ship
                    // separately, and a payload from an older build must not
                    // fail the whole parse and leave the device with no
                    // schedule at all. Absent means null means "use the priority
                    // default", which is the correct behaviour anyway.
                    priorityLevel = m.stringOrNull("priorityLevel"),
                    retryLadderIntervalMinutes = m.intOrNull("retryIntervalMinutes"),
                    retryLadderCount = m.intOrNull("retryCount"),
                )
            }
        } catch (e: Exception) {
            call.reject("syncSchedule payload parse error: ${e.message}")
            return
        }

        val incomingUserId = call.getString("userId")

        // The alarm screen is Kotlin and cannot read the web's UI mode, so the
        // web sends it. Absent (an older deployed build) leaves the stored value
        // alone rather than resetting someone to the standard screen — see
        // [AlarmPrefs].
        call.getBoolean("elderly")?.let { AlarmPrefs.setElderly(context, it) }
        // Same argument: the alarm screen cannot read profiles.alarm_ring_seconds.
        // Clamped on arrival — the DB CHECK is the real limit, but this value
        // drives a lit, ringing screen and the device must be safe against a bad
        // sync as well as a bad form.
        call.getInt("ringSeconds")?.let { AlarmPrefs.setRingSeconds(context, it) }
        // THE IN-APP LANGUAGE. Same argument again, and the sharpest case of it:
        // Android picks `values-hi/` from the DEVICE locale, which is not the
        // language the user chose in this app. Without this the alarm speaks the
        // phone's language while every other screen speaks theirs. Validated and
        // narrowed to a base tag inside setLanguage; an unknown or absent value
        // leaves the last known choice alone rather than resetting to English.
        AlarmPrefs.setLanguage(context, call.getString("language"))

        scope.launch {
            val dao = ScheduleDatabase.getInstance(context).medicationDao()

            // ACCOUNT SWITCH GUARD. Found on-device 2026-08-11: signed in as a
            // guest, the native store still held the previous account's 12
            // medications and rang for them — alarms for doses the current user
            // does not have. The store must belong to exactly one identity, so a
            // different userId wipes it outright rather than layering on top.
            val currentOwner = SessionStore.ownerUserId(context)
            if (incomingUserId != null && currentOwner != null && incomingUserId != currentOwner) {
                Log.w(
                    AlarmScheduler.TAG,
                    "ACCOUNT SWITCH: store belonged to $currentOwner, sync is for $incomingUserId — " +
                        "cancelling that account's alarms and wiping the local store before syncing",
                )
                AlarmScheduler.cancelAllKnown(context)
                dao.deleteAll()
                // A pending snooze is one account's deferred dose; it must not
                // survive into another's schedule.
                runCatching { ScheduleDatabase.getInstance(context).pendingSnoozeDao().clearAll() }
                // A ladder belongs to the account that started it. Left behind,
            // it would re-ask the NEXT person to sign in about medication
            // that is not theirs -- the same failure clearSchedule exists
            // to prevent, verified on device 2026-08-11.
            runCatching { ScheduleDatabase.getInstance(context).pendingRetryDao().clearAll() }
            }
            if (incomingUserId != null) {
                SessionStore.setOwnerUserId(context, incomingUserId)
            }

            // An empty incoming list is legitimate (all medications deleted) but
            // is ALSO what a signed-out or guest session looks like, and it wipes
            // every alarm on this device. Loud, because it is otherwise invisible
            // and looks exactly like "the alarms just stopped working".
            if (medications.isEmpty() && dao.getAll().isNotEmpty()) {
                Log.w(
                    AlarmScheduler.TAG,
                    "syncSchedule received ZERO medications while the local store is NOT empty — " +
                        "clearing every alarm on this device. If this was unexpected, check WHICH " +
                        "account the webview is signed into (a guest session owns no medications).",
                )
            }

            // Cancel the OLD set's alarms before the store is replaced, or
            // deleted medications leave orphaned alarms behind (see cancelAllKnown).
            AlarmScheduler.cancelAllKnown(context)
            dao.replaceAll(medications)
            // Alarms are re-registered from the store immediately, so a
            // medication edit takes effect without waiting for anything.
            AlarmScheduler.rescheduleAll(context)

            val result = JSObject()
            result.put("synced", medications.size)
            result.put("canScheduleExactAlarms", AlarmScheduler.canScheduleExact(context))
            call.resolve(result)
        }
    }

    /**
     * `clearSchedule()` — called by the web on logout / login / account switch.
     *
     * Wipes the local medication store AND cancels every registered alarm, so the
     * previous account's doses can never ring for whoever is signed in next.
     *
     * Order matters: the action queue is flushed FIRST, while the outgoing
     * session is still valid, because after this the credential is gone and any
     * un-synced Taken/Skip could never reach the server. The queue itself is then
     * left in place rather than deleted — a stranded action is recoverable, a
     * deleted one is not.
     */
    @PluginMethod
    fun clearSchedule(call: PluginCall) {
        scope.launch {
            val flushed = runCatching { ActionSync.flush(context) }.getOrDefault(0)

            AlarmScheduler.cancelAllKnown(context)
            ScheduleDatabase.getInstance(context).medicationDao().deleteAll()
            runCatching { ScheduleDatabase.getInstance(context).pendingSnoozeDao().clearAll() }
            // A ladder belongs to the account that started it. Left behind,
            // it would re-ask the NEXT person to sign in about medication
            // that is not theirs -- the same failure clearSchedule exists
            // to prevent, verified on device 2026-08-11.
            runCatching { ScheduleDatabase.getInstance(context).pendingRetryDao().clearAll() }
            // Hydration belongs to the account that set it up.
            runCatching { WaterPrefs.clear(context); WaterNudge.cancel(context) }

            val stranded = runCatching {
                ScheduleDatabase.getInstance(context).doseActionDao().allUnsynced().size
            }.getOrDefault(0)
            if (stranded > 0) {
                Log.w(
                    AlarmScheduler.TAG,
                    "clearSchedule: $stranded dose action(s) still unsynced and now have no session. " +
                        "Kept, not deleted — they retry if this account signs in again.",
                )
            }

            SessionStore.clearSession(context)
            Log.i(AlarmScheduler.TAG, "clearSchedule: local store wiped and all alarms cancelled")

            val result = JSObject()
            result.put("cleared", true)
            result.put("syncedBeforeClear", flushed)
            result.put("strandedActions", stranded)
            call.resolve(result)
        }
    }

    /**
     * `setSession({ accessToken, refreshToken, expiresAt, supabaseUrl,
     * supabaseAnonKey, userId })` — the webview hands over its Supabase session
     * so native can call RPCs as this user. Stored encrypted (see [SessionStore]).
     *
     * Also drains the action queue immediately: this is the moment a previously
     * un-syncable Taken/Skip becomes syncable, so it is the single most useful
     * place to retry.
     */
    @PluginMethod
    fun setSession(call: PluginCall) {
        val accessToken = call.getString("accessToken")
        val refreshToken = call.getString("refreshToken")
        val supabaseUrl = call.getString("supabaseUrl")
        val supabaseAnonKey = call.getString("supabaseAnonKey")

        if (accessToken.isNullOrBlank() || supabaseUrl.isNullOrBlank() || supabaseAnonKey.isNullOrBlank()) {
            call.reject("setSession requires accessToken, supabaseUrl and supabaseAnonKey")
            return
        }

        SessionStore.save(
            context = context,
            accessToken = accessToken,
            refreshToken = refreshToken ?: "",
            expiresAt = call.getInt("expiresAt")?.toLong() ?: 0L,
            supabaseUrl = supabaseUrl.trimEnd('/'),
            supabaseAnonKey = supabaseAnonKey,
            userId = call.getString("userId"),
        )

        scope.launch {
            // RE-QUEUE BEFORE FLUSHING. A fresh session is the one event that can
            // rescue an action which exhausted its retries against a dead token —
            // and without this the flush below skips exactly those rows, because
            // `pending()` filters on `attempts < 5`. Paid for 2026-08-18: a Taken
            // stranded on `HTTP 401 ... PGRST303 JWT expired` was invisible to
            // every later sync even though a valid session had arrived.
            val requeued = runCatching {
                ScheduleDatabase.getInstance(context).doseActionDao().requeueUnsynced()
            }.getOrDefault(0)
            if (requeued > 0) {
                Log.i(
                    AlarmScheduler.TAG,
                    "a fresh session arrived — re-queued $requeued unsynced dose action(s) for another attempt",
                )
            }
            val synced = runCatching { ActionSync.flush(context) }.getOrDefault(0)
            val result = JSObject()
            result.put("stored", true)
            result.put("requeuedActions", requeued)
            result.put("syncedPendingActions", synced)
            call.resolve(result)
        }
    }

    /**
     * `getPendingActions()` — Taken/Skip/Snooze taps not yet accepted by the
     * server. Exists so the web UI can say "N actions syncing" instead of
     * silently disagreeing with the server for a while.
     */
    /**
     * Everything the web needs to tell the user whether alarms will actually
     * fire on THIS device (M3 OEM onboarding).
     *
     * Read-only and permission-free. The web owns the UI because in `server.url`
     * mode the deployed site *is* the app's interface — native's job here is only
     * to answer questions the webview cannot.
     */
    @PluginMethod
    fun getReliabilityStatus(call: PluginCall) {
        val result = JSObject()
        result.put("manufacturer", DeviceReliability.manufacturer())
        result.put("brand", DeviceReliability.brand())
        result.put("isAggressiveOem", DeviceReliability.isAggressiveOem())
        result.put("ignoringBatteryOptimizations", DeviceReliability.isIgnoringBatteryOptimizations(context))
        result.put("canScheduleExactAlarms", AlarmScheduler.canScheduleExact(context))
        result.put("notificationsEnabled", DeviceReliability.areNotificationsEnabled(context))
        result.put("canUseFullScreenIntent", DeviceReliability.canUseFullScreenIntent(context))
        result.put("hasAutostartSettings", DeviceReliability.hasAutostartSettings(context))
        call.resolve(result)
    }

    /**
     * Opens one of the settings screens the user must act on themselves. The app
     * cannot grant any of these — that is the whole point of them — so the most
     * it can do is remove the navigation guesswork.
     */
    @PluginMethod
    fun openReliabilitySetting(call: PluginCall) {
        val target = call.getString("target")
        if (target !in setOf("battery", "autostart", "notifications", "exactAlarms")) {
            call.reject("unknown reliability target: $target")
            return
        }
        // Walks an ordered chain and reports WHICH intent worked, so the web can
        // show written steps when nothing did — and so the candidate list can be
        // improved from real devices rather than from guesswork.
        val openedVia = DeviceReliability.open(context, target!!)
        call.resolve(
            JSObject()
                .put("opened", openedVia != null)
                .put("openedVia", openedVia),
        )
    }

    @PluginMethod
    fun getPendingActions(call: PluginCall) {
        scope.launch {
            val unsynced = ScheduleDatabase.getInstance(context).doseActionDao().allUnsynced()
            val arr = JSArray()
            unsynced.forEach { action ->
                arr.put(
                    JSObject().apply {
                        put("id", action.id)
                        put("medicationId", action.medicationId)
                        put("drugName", action.drugName)
                        put("scheduledFor", action.scheduledFor)
                        put("action", action.action)
                        put("recordedAt", action.recordedAt)
                        put("attempts", action.attempts)
                        put("syncError", action.syncError)
                    },
                )
            }
            val result = JSObject()
            result.put("actions", arr)
            call.resolve(result)
        }
    }

    /**
     * `doseResolved({ doses: [{ medicationId, scheduledFor, action }] })` — the
     * webview telling the device about an answer the SERVER already has.
     *
     * **This is what kills a retry ladder for an in-app answer.** The rail, the
     * dose gate and elderly mode all resolve straight to Supabase; before this
     * existed, the device never heard, so `pending_retries` kept ringing every
     * five minutes at a patient who had answered in the app minutes earlier —
     * found on-device 2026-08-14 with two critical medications showing as
     * skipped and still alarming. The notification path had always worked,
     * which is exactly what made it look like the ladder was fine.
     *
     * Deliberately routed through [DoseActionQueue.record] with
     * `alreadyOnServer = true` rather than calling `cancelLadder` directly.
     * Cancelling the ladder is only one of the things an answer has to do — it
     * also has to leave the dose out of the coalesced alarm group, clear or
     * narrow the notification, and reach a visible alarm screen. A second
     * cancellation path would have covered the first and quietly missed the
     * rest.
     *
     * Idempotent: re-reporting a dose writes another already-synced row, which
     * every reader treats the same as the first.
     */
    @PluginMethod
    fun doseResolved(call: PluginCall) {
        val doses = call.getArray("doses")
        if (doses == null) {
            call.reject("doseResolved requires a 'doses' array")
            return
        }

        val parsed = try {
            (0 until doses.length()).map { i ->
                val d = doses.getJSONObject(i)
                Triple(
                    d.getLong("medicationId"),
                    d.getString("scheduledFor"),
                    d.stringOrNull("action") ?: DoseAction.ACTION_TAKEN,
                )
            }
        } catch (e: Exception) {
            call.reject("doseResolved payload parse error: ${e.message}")
            return
        }

        scope.launch {
            var applied = 0
            parsed.forEach { (medicationId, scheduledFor, action) ->
                // SNOOZE is not a resolve — it defers the question, so a ladder
                // must not be cancelled by one arriving down this path.
                val normalised = if (action == DoseAction.ACTION_SKIP) DoseAction.ACTION_SKIP else DoseAction.ACTION_TAKEN
                val name = runCatching {
                    ScheduleDatabase.getInstance(context).medicationDao().getById(medicationId)?.drugName
                }.getOrNull() ?: "your medication"

                val ok = runCatching {
                    DoseActionQueue.record(
                        context = context,
                        medicationId = medicationId,
                        drugName = name,
                        scheduledFor = scheduledFor,
                        action = normalised,
                        alreadyOnServer = true,
                    )
                }.getOrDefault(false)
                if (ok) applied++
            }
            Log.i(
                AlarmScheduler.TAG,
                "doseResolved: mirrored $applied of ${parsed.size} server-side answer(s); " +
                    "any retry ladder for them is now cancelled",
            )
            val result = JSObject()
            result.put("applied", applied)
            call.resolve(result)
        }
    }

    /**
     * `getActiveLadders()` — every retry chain still in flight on this device.
     *
     * The webview uses it to reconcile: if a ladder is running for a dose the
     * server already shows as resolved, the answer was made somewhere this
     * device never saw — most often a CAREGIVER answering from their own phone —
     * and it reports it back through [doseResolved].
     *
     * Asking the device first is what keeps that cheap. Ladders are rare (a dose
     * has to have gone unanswered), so the reconciling query on the web runs
     * almost never, and the common app-open does one bridge call and stops.
     */
    @PluginMethod
    fun getActiveLadders(call: PluginCall) {
        scope.launch {
            val ladders = runCatching {
                ScheduleDatabase.getInstance(context).pendingRetryDao().getAll()
            }.getOrDefault(emptyList())

            val arr = JSArray()
            ladders.forEach { ladder ->
                arr.put(
                    JSObject().apply {
                        put("medicationId", ladder.medicationId)
                        put("scheduledFor", ladder.doseAt)
                    },
                )
            }
            val result = JSObject()
            result.put("ladders", arr)
            call.resolve(result)
        }
    }

    /**
     * `syncWater({ enabled, goalCups, cupsToday, nudgeMinutes })` — the web hands
     * over the hydration schedule it already computed.
     *
     * The WEB computes the times (including dropping the ones that clash with a
     * dose) so the settings preview and the phone cannot disagree; `WaterSchedule`
     * exists on this side for picking the NEXT one with no network, and is
     * fixture-matched to the TypeScript.
     *
     * `cupsToday` is the web's count taken as truth — last write wins, not
     * "larger wins", the same rule the web sync uses and for the same reason:
     * larger-wins makes undo impossible.
     */
    @PluginMethod
    fun syncWater(call: PluginCall) {
        val enabled = call.getBoolean("enabled") ?: false
        val goalCups = call.getInt("goalCups") ?: 0
        val minutes = call.getArray("nudgeMinutes")?.let { arr ->
            (0 until arr.length()).mapNotNull { runCatching { arr.getInt(it) }.getOrNull() }
        } ?: emptyList()

        WaterPrefs.save(context, enabled, goalCups, minutes)
        call.getInt("cupsToday")?.let { WaterPrefs.setCups(context, it) }
        if (enabled) WaterNudge.schedule(context) else WaterNudge.cancel(context)

        val result = JSObject()
        result.put("scheduled", if (enabled) minutes.size else 0)
        result.put("cupsToday", WaterPrefs.cupsToday(context))
        call.resolve(result)
    }

    /** Today's count as the DEVICE has it — cups added from the notification. */
    @PluginMethod
    fun getWaterCount(call: PluginCall) {
        val result = JSObject()
        result.put("cupsToday", WaterPrefs.cupsToday(context))
        call.resolve(result)
    }

    // -- ALARM MEDIA ---------------------------------------------------------
    //
    // NATIVE OWNS THE FILES, and that is not a detail. The webview cannot write to
    // app-private storage, and the alarm must show its picture and play its sound
    // in airplane mode with the process dead — so the picker runs here, the bytes
    // are copied here, and the web only ever learns WHICH choice is active. That
    // is the opposite direction from `elderly` and `ringSeconds`, which are web
    // data the device mirrors. See BRIDGE_CONTRACT.md §1c.
    //
    // ACTION_OPEN_DOCUMENT rather than the photo picker or MediaStore: it needs no
    // permission on any API level this app supports, so the manifest's permission
    // list is unchanged. CLAUDE.md treats that list as a promise, and "the user
    // picked a wallpaper" is not a reason to start reading their photo library.

    @PluginMethod
    fun getAlarmMedia(call: PluginCall) {
        val result = JSObject()
        result.put("imageChoice", AlarmPrefs.imageChoice(context))
        result.put("soundChoice", AlarmPrefs.soundChoice(context))
        result.put("bundled", JSArray(AlarmMedia.BUNDLED.keys.toList()))
        result.put("hasCustomImage", AlarmMedia.imageFile(context).let { it.isFile && it.length() > 0L })
        result.put("hasCustomSound", AlarmMedia.soundFile(context).let { it.isFile && it.length() > 0L })
        call.resolve(result)
    }

    /** Select a bundled backdrop by key, or `none`. Custom is set by [pickAlarmImage]. */
    @PluginMethod
    fun setAlarmImage(call: PluginCall) {
        val choice = call.getString("choice") ?: AlarmMedia.IMAGE_NONE
        if (choice != AlarmMedia.IMAGE_NONE && !AlarmMedia.BUNDLED.containsKey(choice)) {
            call.reject("unknown alarm image choice: $choice")
            return
        }
        // Selecting a bundled image also drops the copied file. Keeping it would
        // leave a megabyte of someone's photo on disk that nothing can reach.
        if (choice == AlarmMedia.IMAGE_NONE) AlarmMedia.clearImage(context) else {
            runCatching { AlarmMedia.imageFile(context).delete() }
            AlarmPrefs.setImageChoice(context, choice)
        }
        getAlarmMedia(call)
    }

    @PluginMethod
    fun clearAlarmSound(call: PluginCall) {
        AlarmMedia.clearSound(context)
        getAlarmMedia(call)
    }

    /**
     * `renderAlarmPreview({ width? })` — a picture of the REAL alarm screen.
     *
     * Native inflates the same layouts, binds them through the same
     * [AlarmScreenBinder], and draws the result to a bitmap. The webview shows it
     * in an `<img>`. That is the point: a CSS recreation in Settings would be a
     * second implementation of the most safety-critical screen in the product,
     * and the moment the two diverged the preview would be a lie about what
     * someone sees at 3am — with no way to check until then.
     *
     * Resolves with a null `dataUri` rather than rejecting when the render fails:
     * a settings screen must not break because a picture could not be drawn.
     */
    @PluginMethod
    fun renderAlarmPreview(call: PluginCall) {
        val width = call.getInt("width") ?: 420
        scope.launch {
            val uri = runCatching { AlarmPreview.renderDataUri(context, width.coerceIn(160, 1080)) }
                .getOrNull()
            val result = JSObject()
            result.put("dataUri", uri)
            call.resolve(result)
        }
    }

    /** Hear the chosen sound. Non-looping and self-stopping — see [AlarmSoundPreview]. */
    @PluginMethod
    fun previewAlarmSound(call: PluginCall) {
        val started = runCatching { AlarmSoundPreview.play(context) }.getOrDefault(false)
        val result = JSObject()
        result.put("playing", started)
        call.resolve(result)
    }

    @PluginMethod
    fun stopAlarmSoundPreview(call: PluginCall) {
        runCatching { AlarmSoundPreview.stop() }
        val result = JSObject()
        result.put("playing", false)
        call.resolve(result)
    }

    @PluginMethod
    fun pickAlarmImage(call: PluginCall) {
        startActivityForResult(call, openDocument("image/*"), "onAlarmImagePicked")
    }

    @PluginMethod
    fun pickAlarmSound(call: PluginCall) {
        startActivityForResult(call, openDocument("audio/*"), "onAlarmSoundPicked")
    }

    private fun openDocument(mime: String): Intent =
        Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mime
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

    @ActivityCallback
    private fun onAlarmImagePicked(call: PluginCall?, result: ActivityResult) {
        finishPick(call, result) { uri -> AlarmMedia.importImage(context, uri) != null }
    }

    @ActivityCallback
    private fun onAlarmSoundPicked(call: PluginCall?, result: ActivityResult) {
        finishPick(call, result) { uri -> AlarmMedia.importSound(context, uri) != null }
    }

    /**
     * Cancelling is not an error — it is the commonest outcome of opening a file
     * picker, and rejecting the call would surface a failure message for someone
     * who simply changed their mind. Resolves with `picked: false` and the state
     * untouched.
     */
    private fun finishPick(call: PluginCall?, result: ActivityResult, importer: (Uri) -> Boolean) {
        if (call == null) return
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            val out = JSObject()
            out.put("picked", false)
            call.resolve(out)
            return
        }
        scope.launch {
            val ok = runCatching { importer(uri) }.getOrDefault(false)
            val out = JSObject()
            out.put("picked", ok)
            out.put("imageChoice", AlarmPrefs.imageChoice(context))
            out.put("soundChoice", AlarmPrefs.soundChoice(context))
            if (!ok) out.put("error", "The file could not be copied. It may be too large or unreadable.")
            call.resolve(out)
        }
    }

    /**
     * TEST HELPER (step 3) — fires a real alarm `seconds` from now through the
     * exact same AlarmManager path a real dose uses, so alarm timing and
     * delivery can be verified on a device without waiting for a real dose
     * time. Uses a synthetic negative medication id so [AlarmReceiver] knows
     * there is no row behind it and skips rescheduling.
     *
     * Remove once M2 is verified end to end; it is a debugging affordance, not
     * a product feature.
     */
    @PluginMethod
    fun scheduleTestAlarm(call: PluginCall) {
        val seconds = call.getInt("seconds") ?: 60
        val fireAt = Instant.now().plusSeconds(seconds.toLong())

        AlarmScheduler.scheduleAt(
            context = context,
            medicationId = -1L,
            drugName = "Test alarm",
            doseLabel = "Fired ${seconds}s after scheduling",
            fireAt = fireAt,
        )

        val result = JSObject()
        result.put("scheduledFor", fireAt.toString())
        result.put("canScheduleExactAlarms", AlarmScheduler.canScheduleExact(context))
        call.resolve(result)
    }

    /**
     * Debug-only for this step: lets you confirm from the webview's own
     * console (or a quick logcat print) what actually landed in the local
     * database, without needing Android Studio's Database Inspector.
     */
    @PluginMethod
    fun getSchedule(call: PluginCall) {
        scope.launch {
            val all = ScheduleDatabase.getInstance(context).medicationDao().getAll()
            val arr = JSArray()
            all.forEach { med ->
                val obj = JSObject()
                obj.put("id", med.id)
                obj.put("drugName", med.drugName)
                obj.put("reminderTimes", JSArray(med.reminderTimes))
                obj.put("timezone", med.timezone)
                obj.put("nextReminderAt", med.nextReminderAt)
                obj.put("active", med.active)
                arr.put(obj)
            }
            val result = JSObject()
            result.put("medications", arr)
            call.resolve(result)
        }
    }
}

/**
 * `JSONObject.optString(key, null)` is a Java-interop trap: the overload's
 * fallback is declared non-null, so Kotlin warns, and `optString(key)` alone
 * returns "" rather than null for a missing key. This maps absent / JSON-null /
 * empty all to a real Kotlin null, which is what [Medication]'s nullable
 * fields actually mean.
 */
/**
 * An optional integer from the payload.
 *
 * Absent and JSON null both become Kotlin null, which the retry ladder reads as
 * "use the priority default". Distinct from `optInt`, which returns 0 for a
 * missing key -- and 0 is a value the ladder would reject, so the difference
 * between "not configured" and "configured to zero" has to survive.
 */
private fun JSONObject.intOrNull(key: String): Int? =
    if (!has(key) || isNull(key)) null else getInt(key)

private fun JSONObject.stringOrNull(key: String): String? =
    if (!has(key) || isNull(key)) null else optString(key).ifEmpty { null }
