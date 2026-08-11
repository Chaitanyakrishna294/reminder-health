package com.reminderhealth.app.schedule

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import java.time.Instant

/**
 * Registers exact alarms with the OS for upcoming doses.
 *
 * **One pending alarm per active medication — its own next dose, and nothing
 * further out.** That is what CLAUDE.md's "only the next few upcoming doses,
 * rescheduled after each fires" means in practice: the count is bounded by the
 * number of medications (never hundreds of future occurrences), and each
 * medication's next alarm is registered only once its previous one has fired.
 * `AlarmReceiver` does that re-registration, so there is no polling, no timer,
 * and no foreground service anywhere in this path.
 *
 * Alarm times come from [calculateNextReminder] — the fixture-verified port —
 * NOT from the server's `nextReminderAt`, which is only a seed value that goes
 * stale the moment a dose fires (see BRIDGE_CONTRACT.md).
 */
object AlarmScheduler {
    const val TAG = "AlarmScheduler"

    const val EXTRA_MEDICATION_ID = "medicationId"
    const val EXTRA_DRUG_NAME = "drugName"
    const val EXTRA_DOSE_LABEL = "doseLabel"
    const val EXTRA_SCHEDULED_FOR = "scheduledFor"

    /**
     * Family voice alarms (CLAUDE.md "Post-M2 features"). LOCAL file paths only —
     * carried through the alarm so [AlarmActivity] needs no DB read and no
     * network to personalise the alarm.
     */
    const val EXTRA_AUDIO_PATH = "alarmAudioPath"
    const val EXTRA_PHOTO_PATH = "alarmPhotoPath"

    /**
     * False only on Android 12+ when the user has revoked exact-alarm access.
     * The app declares `USE_EXACT_ALARM` (auto-granted on 13+ for alarm-class
     * apps — medication reminders qualify, see CLAUDE.md), so this is expected
     * to be true in practice; checked anyway because
     * `setExactAndAllowWhileIdle` throws SecurityException if it is not.
     */
    fun canScheduleExact(context: Context): Boolean {
        val manager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return false
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) manager.canScheduleExactAlarms() else true
    }

    /**
     * Cancels every known alarm and re-registers one per active medication.
     * Called after [ScheduleBridgePlugin.syncSchedule] replaces the store, and
     * (from step 5) after boot.
     */
    /**
     * Cancels the alarm for every medication currently in the store.
     *
     * Must run BEFORE the store is replaced. [rescheduleAll] can only cancel
     * what it can still see, so a medication that has just been deleted — or an
     * entire account's worth after a sign-out/account switch — would otherwise
     * leave an ORPHANED alarm registered with AlarmManager: it still fires, but
     * [AlarmReceiver] then finds no row behind it. Found 2026-08-11 when a sync
     * arrived with an empty medication list.
     */
    suspend fun cancelAllKnown(context: Context) {
        val medications = ScheduleDatabase.getInstance(context).medicationDao().getAll()
        if (medications.isEmpty()) return
        Log.i(TAG, "cancelling ${medications.size} previously-scheduled alarm(s) before re-sync")
        medications.forEach { cancel(context, it.id) }
    }

    suspend fun rescheduleAll(context: Context) {
        val medications = ScheduleDatabase.getInstance(context).medicationDao().getAll()
        Log.i(TAG, "rescheduleAll: ${medications.size} medication(s) in the local store")
        medications.forEach { medication ->
            cancel(context, medication.id)
            if (medication.active) {
                scheduleNext(context, medication)
            } else {
                Log.i(TAG, "med ${medication.id} (${medication.drugName}) is inactive; no alarm")
            }
        }
    }

    /**
     * Registers [medication]'s next dose after [from].
     *
     * Mirrors src/scheduler.js's DATA PROBLEM guard: an empty `reminderTimes`
     * makes [calculateNextReminder] throw by contract, so it is filtered here
     * rather than allowed to reach the calculation — one unschedulable row must
     * never abort the rest of the batch.
     */
    fun scheduleNext(context: Context, medication: Medication, from: Instant = Instant.now()) {
        if (medication.reminderTimes.isEmpty()) {
            Log.e(
                TAG,
                "DATA PROBLEM: med ${medication.id} (${medication.drugName}) has no reminderTimes; " +
                    "skipping — fix the row's reminder_times to resume reminders",
            )
            return
        }

        val fireAt = try {
            calculateNextReminder(medication.reminderTimes, medication.timezone, medication.doseDays, from)
        } catch (e: Exception) {
            Log.e(TAG, "calculateNextReminder failed for med ${medication.id} (${medication.drugName})", e)
            return
        }

        val doseLabel = listOfNotNull(
            medication.dosageAmount.takeIf { it > 0 }?.let { amount ->
                val trimmed = if (amount % 1.0 == 0.0) amount.toInt().toString() else amount.toString()
                listOfNotNull(trimmed, medication.unitType).joinToString(" ")
            },
            medication.dosage?.takeIf { it.isNotBlank() && it != "N/A" },
        ).firstOrNull()

        scheduleAt(
            context = context,
            medicationId = medication.id,
            drugName = medication.drugName,
            doseLabel = doseLabel,
            fireAt = fireAt,
            audioPath = medication.alarmAudioPath,
            photoPath = medication.alarmPhotoPath,
        )
        Log.i(
            TAG,
            "med ${medication.id} (${medication.drugName}) next dose $fireAt " +
                "[tz=${medication.timezone}, times=${medication.reminderTimes}, doseDays=${medication.doseDays}]",
        )
    }

    /**
     * Registers one exact alarm at [fireAt]. Split out from [scheduleNext] so
     * "when is the next dose" (fixture-verified, [calculateNextReminder]) stays
     * separate from "hand an alarm to the OS" — and so the step-3 test helper
     * can exercise this real delivery path at an arbitrary time without faking
     * a medication schedule to get there.
     */
    fun scheduleAt(
        context: Context,
        medicationId: Long,
        drugName: String,
        doseLabel: String?,
        fireAt: Instant,
        audioPath: String? = null,
        photoPath: String? = null,
    ) {
        val manager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: run {
            Log.e(TAG, "AlarmManager unavailable; cannot schedule med $medicationId")
            return
        }

        // Re-fire-loop guard.
        //
        // The server's `nextReminderAt` is NEVER used to set an alarm — it is
        // stored and ignored, and fire times come only from calculateNextReminder,
        // which returns an instant strictly AFTER its `now`. So a stale/past
        // nextReminderAt in a sync payload (e.g. 2026-08-10T20:40Z arriving at
        // 01:32) structurally cannot register an immediate fire. This check exists
        // to make that PROVABLE on device rather than merely argued: a past or
        // near-instant fireAt could only come from a bug, and
        // setExactAndAllowWhileIdle on a past time fires immediately, so an
        // unguarded one is exactly how a fire loop would start.
        val minimumFireAt = Instant.now().plusSeconds(5)
        if (fireAt.isBefore(minimumFireAt)) {
            Log.e(
                TAG,
                "REFUSING to schedule med $medicationId ($drugName) at $fireAt — that is in the past " +
                    "or under 5s away, which would fire immediately and risk a re-fire loop. " +
                    "Fire times must come from calculateNextReminder, never from the server's " +
                    "nextReminderAt. Not scheduling; the next sync or boot will recompute.",
            )
            return
        }

        val intent = Intent(context, AlarmReceiver::class.java).apply {
            // PendingIntent equality IGNORES extras, so two alarms that differ
            // only by extras would collide and share whichever extras were set
            // first. A unique data URI per medication (plus the distinct
            // request code below) keeps them genuinely separate.
            data = Uri.parse("reminderhealth://dose/$medicationId")
            putExtra(EXTRA_MEDICATION_ID, medicationId)
            putExtra(EXTRA_DRUG_NAME, drugName)
            putExtra(EXTRA_DOSE_LABEL, doseLabel)
            putExtra(EXTRA_SCHEDULED_FOR, fireAt.toString())
            putExtra(EXTRA_AUDIO_PATH, audioPath)
            putExtra(EXTRA_PHOTO_PATH, photoPath)
        }

        val pendingIntent = PendingIntent.getBroadcast(
            context,
            requestCode(medicationId),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        try {
            manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt.toEpochMilli(), pendingIntent)
            Log.i(TAG, "EXACT alarm registered: med $medicationId ($drugName) at $fireAt")
        } catch (e: SecurityException) {
            // Only reachable if exact-alarm access was revoked (Android 12+).
            // Fall back to an inexact alarm rather than silently scheduling
            // nothing — late is far better than never for a medication — and
            // log loudly so this is visible rather than mysterious.
            Log.e(TAG, "exact alarm denied for med $medicationId; falling back to INEXACT", e)
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt.toEpochMilli(), pendingIntent)
        }
    }

    fun cancel(context: Context, medicationId: Long) {
        val manager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            data = Uri.parse("reminderhealth://dose/$medicationId")
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            requestCode(medicationId),
            intent,
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
        )
        if (pendingIntent != null) {
            manager.cancel(pendingIntent)
            pendingIntent.cancel()
        }
    }

    /**
     * PendingIntent request codes are Int; `medications.id` is a Postgres
     * bigint. Real ids are small serials (live max is in the low hundreds), so
     * the narrowing is safe in practice — but hash rather than truncate so
     * two ids differing only above bit 32 could never collide silently.
     */
    private fun requestCode(medicationId: Long): Int = medicationId.hashCode()
}
