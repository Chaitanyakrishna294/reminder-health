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
     * True when this firing is a retry RUNG rather than the dose's first ring.
     *
     * PRESENTATION ONLY -- it decides the wording, nothing else. Whether the
     * ladder advances is decided from the `pending_retries` table, because
     * extras do not survive a reboot and a rebuilt rung must behave exactly like
     * the one it replaced. Flag for what the patient reads, table for what the
     * device does.
     */
    const val EXTRA_IS_RETRY = "isRetry"

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
        val db = ScheduleDatabase.getInstance(context)
        val medications = db.medicationDao().getAll()
        val snoozeDao = db.pendingSnoozeDao()
        val retryDao = db.pendingRetryDao()
        Log.i(TAG, "rescheduleAll: ${medications.size} medication(s) in the local store")
        val now = Instant.now()

        medications.forEach { medication ->
            cancel(context, medication.id)
            if (!medication.active) {
                Log.i(TAG, "med ${medication.id} (${medication.drugName}) is inactive; no alarm")
                return@forEach
            }

            // A snooze outranks the next scheduled dose: the patient explicitly
            // asked to be re-asked about THIS dose, and that promise has to
            // survive a reboot or a re-sync. Without this, rebuilding from
            // reminder_times alone silently skipped the re-prompt entirely.
            val snooze = snoozeDao.get(medication.id)
            if (snooze != null) {
                val fireAt = runCatching { Instant.parse(snooze.fireAt) }.getOrNull()
                val doseAt = runCatching { Instant.parse(snooze.doseAt) }.getOrNull()
                if (fireAt != null && doseAt != null && fireAt.isAfter(now)) {
                    scheduleAt(
                        context = context,
                        medicationId = medication.id,
                        drugName = medication.drugName,
                        doseLabel = doseLabelFor(medication),
                        fireAt = fireAt,
                        audioPath = medication.alarmAudioPath,
                        photoPath = medication.alarmPhotoPath,
                        scheduledFor = doseAt,
                    )
                    Log.i(
                        TAG,
                        "med ${medication.id} (${medication.drugName}) has a pending SNOOZE — " +
                            "re-prompting at $fireAt for the dose due $doseAt",
                    )
                    return@forEach
                }

                // The re-fire came due while the device was off. Deliberately NOT
                // fired late here: an alarm for a dose from hours ago is startling
                // and, worse, ambiguous. The dose is still unresolved server-side
                // with retry_reminder_at set, so the escalation ladder and the
                // Telegram/push re-prompt still own it — same division of labour
                // as every other missed dose.
                Log.i(
                    TAG,
                    "med ${medication.id} (${medication.drugName}) had a SNOOZE due ${snooze.fireAt} " +
                        "that passed while the device was off; clearing it — the server still owns " +
                        "this dose via retry_reminder_at",
                )
                snoozeDao.clear(medication.id)
            }

            // A LADDER IN FLIGHT OUTRANKS THE NEXT DOSE, for the same reason a
            // snooze does: the device promised to ask again about THIS dose, and
            // Android dropped the registration at shutdown. Rebuilding from
            // reminder_times alone would silently swallow a critical
            // medication's remaining rungs -- the failure this table exists for.
            val ladder = retryDao.get(medication.id)
            if (ladder != null) {
                val ladderDoseAt = runCatching { Instant.parse(ladder.doseAt) }.getOrNull()
                if (ladderDoseAt == null) {
                    retryDao.clear(medication.id)
                } else if (armRung(context, medication, ladderDoseAt, ladder.offsets(), "rebuilt after boot")) {
                    return@forEach
                } else {
                    // The phone slept through the whole ladder. Leave the sticky
                    // so the dose stays visibly unanswered rather than vanishing,
                    // then fall through and register the next dose.
                    DoseNotifications.showMissedGroup(context, ladder.doseAt, DoseRow.of(medication))
                }
            }

            scheduleNext(context, medication)
        }
    }


    // -- RETRY LADDER --------------------------------------------------------
    //
    // One pending alarm per medication is the model this whole file is built on
    // (see [requestCode] and the per-medication data URI), and a ladder fits it
    // because a ladder is SEQUENTIAL: only the next rung is ever registered, and
    // firing it registers the one after.
    //
    // That does mean a live rung temporarily REPLACES the next-dose alarm. It
    // heals on its own -- every fire re-registers the next dose (AlarmReceiver),
    // and the last rung's fire is what makes that stick -- but it is why a reboot
    // mid-ladder must be handled explicitly in [rescheduleAll] rather than left
    // to "rebuild from reminder_times", which would drop the ladder AND ring the
    // next dose as if nothing had been pending.
    //
    // Rungs carry the ORIGINAL dose instant as `scheduledFor`, never their own
    // fire time. That is the same identity rule the snooze split was fixed for:
    // the server resolves on `(medication_id, scheduled_for)`, so a rung that
    // announced itself as its own dose would make the patient's answer
    // unsaveable.

    /**
     * Begin the ladder for a dose that has just rung unanswered.
     *
     * @return true when a rung was registered; false when this medication's
     *   ladder is empty, in which case the caller should leave the sticky.
     */
    suspend fun startLadder(context: Context, medication: Medication, doseAt: Instant): Boolean {
        return armRung(context, medication, doseAt, RetryLadder.offsetsFor(medication), "started")
    }

    /**
     * Ring the next rung after one has just fired.
     *
     * @return true when another rung was registered; false when the ladder is
     *   exhausted -- the caller posts the sticky missed notice.
     */
    suspend fun advanceLadder(context: Context, medication: Medication, pending: PendingRetry): Boolean {
        val doseAt = runCatching { Instant.parse(pending.doseAt) }.getOrNull() ?: return false
        // Drop the rung that just fired; armRung drops any the device slept through.
        return armRung(context, medication, doseAt, pending.offsets().drop(1), "advanced")
    }

    /**
     * Register the earliest rung still in the future and persist what is left,
     * or clear the ladder when nothing is.
     *
     * Past rungs are DISCARDED rather than fired late. An alarm for a dose whose
     * moment went by while the phone was off is startling and ambiguous, and the
     * server still owns the dose through the escalation ladder -- the same
     * division of labour the snooze-through-shutdown branch already follows.
     */
    private suspend fun armRung(
        context: Context,
        medication: Medication,
        doseAt: Instant,
        offsets: List<Int>,
        verb: String,
    ): Boolean {
        val dao = ScheduleDatabase.getInstance(context).pendingRetryDao()
        val now = Instant.now()
        val future = offsets.filter { doseAt.plusSeconds(it * 60L).isAfter(now) }

        val row = PendingRetry.of(medication.id, doseAt.toString(), future)
        if (row == null) {
            dao.clear(medication.id)
            Log.i(
                TAG,
                "retry ladder for med " + medication.id + " (" + medication.drugName + ") is exhausted " +
                    "(dose " + doseAt + ") -- leaving the sticky missed notice",
            )
            return false
        }

        dao.upsert(row)
        val fireAt = doseAt.plusSeconds(future.first() * 60L)
        scheduleAt(
            context = context,
            medicationId = medication.id,
            drugName = medication.drugName,
            doseLabel = doseLabelFor(medication),
            fireAt = fireAt,
            audioPath = medication.alarmAudioPath,
            photoPath = medication.alarmPhotoPath,
            // THE ORIGINAL DOSE, not the rung's own time. See the block comment.
            scheduledFor = doseAt,
            isRetry = true,
        )
        Log.i(
            TAG,
            "retry ladder " + verb + " for med " + medication.id + " (" + medication.drugName + "): " +
                "next rung +" + future.first() + "min at " + fireAt + " for the dose due " + doseAt +
                " (remaining " + future.joinToString() + ")",
        )
        return true
    }

    /**
     * The dose was answered, from any surface -- cancel the chain and put the
     * next dose back.
     *
     * Restoring the next-dose alarm is not optional: the live rung occupies this
     * medication's single alarm slot, so cancelling without rescheduling would
     * leave it with no alarm at all until the next sync.
     */
    suspend fun cancelLadder(context: Context, medicationId: Long) {
        val db = ScheduleDatabase.getInstance(context)
        val dao = db.pendingRetryDao()
        if (dao.get(medicationId) == null) return

        dao.clear(medicationId)
        cancel(context, medicationId)
        Log.i(TAG, "retry ladder cancelled for med " + medicationId + " -- the dose was answered")

        val medication = db.medicationDao().getById(medicationId)
        if (medication != null && medication.active) {
            scheduleNext(context, medication)
        }
    }

    /**
     * "1 tablet" / "5 ml" — the human-readable dose shown on the alarm. Shared so
     * a snooze re-registration labels itself exactly like the original alarm did.
     */
    fun doseLabelFor(medication: Medication): String? = listOfNotNull(
        medication.dosageAmount.takeIf { it > 0 }?.let { amount ->
            val trimmed = if (amount % 1.0 == 0.0) amount.toInt().toString() else amount.toString()
            listOfNotNull(trimmed, medication.unitType).joinToString(" ")
        },
        medication.dosage?.takeIf { it.isNotBlank() && it != "N/A" },
    ).firstOrNull()

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
            // A medication that cannot compute a next dose gets NO alarm, ever
            // again, and says nothing about it. Exactly the silent failure crash
            // reporting exists for — the id is enough to find the row without
            // shipping the drug name anywhere.
            Crash.report("calculateNextReminder failed", medication.id, e)
            return
        }

        val doseLabel = doseLabelFor(medication)

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
        /**
         * The DOSE's own scheduled instant, which is not always when the alarm
         * rings. They differ for a snooze: the alarm re-fires 10 minutes from
         * now, but the dose it is asking about is still the original one.
         *
         * This is the identity the server resolves against
         * (`resolve_reminder_event`'s `(medication_id, scheduled_for)`), so
         * getting it wrong is not cosmetic. Defaulting this to [fireAt] is what
         * broke snooze: a snoozed alarm carried its own re-fire time as the dose
         * instant, so tapping Taken afterwards queued a time that matched no
         * `reminder_times` entry and no event row — permanent
         * INVALID_SCHEDULED_TIME, five retries, answer dropped. Found 2026-08-11.
         */
        scheduledFor: Instant = fireAt,
        /** See [EXTRA_IS_RETRY] -- wording only. */
        isRetry: Boolean = false,
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
            putExtra(EXTRA_SCHEDULED_FOR, scheduledFor.toString())
            putExtra(EXTRA_AUDIO_PATH, audioPath)
            putExtra(EXTRA_PHOTO_PATH, photoPath)
            putExtra(EXTRA_IS_RETRY, isRetry)
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
