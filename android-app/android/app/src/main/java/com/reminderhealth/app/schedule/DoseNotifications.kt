package com.reminderhealth.app.schedule

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.reminderhealth.app.R
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Dose-reminder notifications.
 *
 * The notification is not a fallback for the alarm — much of the time it IS the
 * alarm. Android attaches a **full-screen intent** here (the documented way to
 * get an alarm-clock takeover without `SYSTEM_ALERT_WINDOW`, which CLAUDE.md
 * forbids) and then decides how to present it:
 *
 *  - phone **locked or idle** → the full-screen [AlarmActivity] takes over;
 *  - phone **unlocked and in active use** → a heads-up notification instead.
 *
 * That second case is Android deliberately not hijacking the screen of someone
 * who is demonstrably already using their phone. It is correct behaviour and is
 * not overridden anywhere in this app. The consequence for design: the
 * notification must be *fully answerable on its own*, which is why Taken / Skip
 * / Snooze are attached as actions and routed through [DoseActionReceiver] into
 * the same offline queue the full-screen buttons use. Nobody should have to open
 * a takeover screen to answer a dose they are awake for.
 *
 * ## ONE NOTIFICATION PER DOSE INSTANT, NOT PER MEDICATION (2026-08-14)
 *
 * A person takes their noon medicines as one handful, so they get one
 * notification for that handful. Four medications at 12:00 used to post four
 * notifications with four full-screen intents, and on a real device two of them
 * fought for the screen while the other two sat in the shade unanswered.
 *
 * The identity is therefore [groupId] — derived from the dose instant — and
 * every surface reads its contents from [DosesAtInstant.rowsAt], which asks the
 * schedule rather than asking which alarms happen to be pending. That is what
 * makes a retry rung, a reboot-rebuilt rung and the original ring all coalesce
 * into the same group without any of them knowing about the others.
 *
 * Ladders stay per-medication and independent. Only the presentation coalesces.
 *
 * **Persistence, and its Android 14+ limit.** Both the live alarm and the missed
 * fallback are `setOngoing(true)` + `setAutoCancel(false)`: an unanswered dose
 * must not vanish on a careless swipe, and it stays until the dose is actually
 * resolved (Taken/Skip recorded, or snoozed, which reschedules it). On Android
 * 14+ a user can still *deliberately* dismiss an ongoing notification — the
 * platform stopped treating `setOngoing` as absolute. That is accepted rather
 * than fought: the missed-dose fallback and, above all, the server-side
 * escalation ladder are the real backstop for a dose nobody answers. A
 * notification the OS lets someone dismiss is not the last line of defence, and
 * trying to make it one is how apps end up abusing foreground services.
 */
object DoseNotifications {
    private const val CHANNEL_ID = "dose_reminders"
    private const val CHANNEL_NAME = "Medication reminders"
    private const val MISSED_CHANNEL_ID = "dose_missed"
    private const val MISSED_CHANNEL_NAME = "Missed doses"

    /**
     * Notification-id space, kept deliberately far apart so nothing collides.
     *
     * Group ids are `base + the dose instant's epoch MINUTE` — about 29.7 million
     * in 2026, and still under 60 million a century out, so both families stay
     * inside a signed Int with room to spare. Same instant → same id (a rung
     * replaces its own group's notification rather than stacking); different
     * instants → different ids (an unanswered 08:00 handful and a live 12:00 one
     * coexist, which is exactly right).
     *
     * `medications.id` is a small Postgres serial, so the legacy per-medication
     * ids this replaces live near zero and cannot reach either base.
     */
    private const val GROUP_LIVE_BASE = 1_000_000_000L
    private const val GROUP_MISSED_BASE = 1_500_000_000L

    /** Keeps notification-action request codes clear of the id families above. */
    private const val ACTION_REQUEST_CODE_BASE = 2_000_000L

    private fun epochMinute(iso: String?): Long? =
        iso?.let { runCatching { Instant.parse(it).epochSecond / 60L }.getOrNull() }

    /**
     * The live alarm notification's id for a dose instant.
     *
     * Falls back to the medication id when the instant is unparseable — only
     * reachable by the `scheduleTestAlarm` debug helper, which has no real dose
     * behind it.
     */
    fun groupId(instantIso: String?, medicationId: Long = 0L): Int =
        epochMinute(instantIso)?.let { (GROUP_LIVE_BASE + it).toInt() } ?: medicationId.toInt()

    /** Distinct id so the missed notice doesn't overwrite a live alarm's. */
    fun missedGroupId(instantIso: String?, medicationId: Long = 0L): Int =
        epochMinute(instantIso)?.let { (GROUP_MISSED_BASE + it).toInt() }
            ?: (medicationId + 1_000_000L).toInt()

    /**
     * Idempotent — safe to call on every notification. IMPORTANCE_HIGH is
     * required for a heads-up notification, and is also the minimum the
     * full-screen intent needs.
     */
    @JvmStatic
    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        // No setBypassDnd(true) here: that silently does nothing without
        // ACCESS_NOTIFICATION_POLICY, which is NOT on CLAUDE.md's allowed
        // permission list — so it would have been misleading code implying a
        // guarantee the app cannot make. IMPORTANCE_HIGH is what actually buys
        // the heads-up + sound, and the full-screen intent is what makes a dose
        // alarm genuinely hard to miss.
        val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Alerts when it is time to take a medication"
            enableVibration(true)
        }
        manager.createNotificationChannel(channel)
    }

    /** IMPORTANCE_LOW: visible and persistent, but silent — it must not ring again. */
    private fun ensureMissedChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(MISSED_CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(MISSED_CHANNEL_ID, MISSED_CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW).apply {
                description = "A dose alarm that rang without being answered"
            },
        )
    }

    // -- LIVE ALARM ----------------------------------------------------------

    /**
     * Post the ringing notification for a dose instant.
     *
     * Called synchronously from [AlarmReceiver] with the single dose the alarm
     * carried, so the alarm is never waiting on a database read; [refreshGroup]
     * then widens it to the whole handful a few milliseconds later. Both write
     * the same id, so the patient sees one notification that fills in, never two.
     *
     * [isRetry] changes the WORDING and nothing else.
     *
     * "Still time to take X" rather than "Time to take X": the second and third
     * ask must read as the app being patient, not as the app being cross. There
     * is no "again", no "you still have not", and no count — a person who has
     * not answered twice already knows, and telling them is the one thing this
     * screen must never do. The sticky that follows keeps its own honest
     * record-keeping wording; that is a different job.
     */
    fun showDoseReminder(
        context: Context,
        medicationId: Long,
        drugName: String,
        doseLabel: String?,
        scheduledForIso: String?,
        audioPath: String? = null,
        photoPath: String? = null,
        isRetry: Boolean = false,
    ) {
        val row = DoseRow(medicationId, drugName, doseLabel, audioPath, photoPath)
        postLive(context, scheduledForIso, listOf(row), isRetry, alerting = true)
    }

    /**
     * Re-read the group and bring its notification up to date.
     *
     * The one call every answered dose funnels through ([DoseActionQueue.record]
     * makes it, whichever surface recorded the answer), so "three of four left"
     * and "nothing left, clear it" are the same code path rather than two.
     *
     * Never re-alerts: this runs while the patient is standing there answering,
     * and a notification that re-rang each time they tapped Taken would be the
     * app arguing with them.
     */
    suspend fun refreshGroup(context: Context, scheduledForIso: String?) {
        val rows = DosesAtInstant.rowsAt(context, scheduledForIso)
        if (rows.isEmpty()) {
            cancelGroup(context, scheduledForIso)
            return
        }
        postLive(context, scheduledForIso, rows, isRetry = false, alerting = false)
    }

    /**
     * Widen the just-posted single-dose notification to the whole handful.
     *
     * Not alerting: [showDoseReminder] has already rung, and this is the same
     * notification id gaining its remaining rows.
     */
    suspend fun widenToGroup(context: Context, scheduledForIso: String?, fallback: DoseRow, isRetry: Boolean) {
        val rows = DosesAtInstant.rowsAt(context, scheduledForIso, fallback)
        if (rows.size <= 1) return
        postLive(context, scheduledForIso, rows, isRetry, alerting = false)
        Log.i(
            AlarmScheduler.TAG,
            "coalesced ${rows.size} doses due $scheduledForIso into one notification " +
                "(${rows.joinToString { it.drugName }})",
        )
    }

    private fun postLive(
        context: Context,
        scheduledForIso: String?,
        rows: List<DoseRow>,
        isRetry: Boolean,
        alerting: Boolean,
    ) {
        if (rows.isEmpty()) return
        ensureChannel(context)

        val id = groupId(scheduledForIso, rows.first().medicationId)
        val many = rows.size > 1

        /*
         * ONE HANDFUL, ONE RING.
         *
         * Four medications at 12:00 fire as four separate alarms milliseconds
         * apart, and each one calls this with `alerting = true`. Without this
         * check the same notification id would re-alert four times — four
         * sounds, four vibrations, and four full-screen intent launches for what
         * is one handful. Whichever alarm lands first does the ringing; the rest
         * update the notification silently.
         *
         * A RUNG STILL RINGS: it fires minutes later, by which point the live
         * notification has been answered or replaced by the sticky, so there is
         * nothing active at this id to suppress it. If one somehow is active, the
         * patient is already looking at an alarm for this dose and re-ringing it
         * would be the app raising its voice at someone who can see it.
         */
        val alertNow = alerting && !isShowing(context, id)

        // ONE full-screen intent for the group, keyed on the instant. Four
        // alarms firing milliseconds apart therefore update a single PendingIntent
        // instead of racing to launch four activities — the bug this whole change
        // exists to fix. AlarmActivity re-reads the group itself, so the extras
        // here are a seed, not the list.
        val fullScreen = PendingIntent.getActivity(
            context,
            id,
            alarmIntent(context, scheduledForIso, rows.first()),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            // Shows content (not "contents hidden") on the lock screen, which is
            // where a dose alarm most needs to be readable.
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            // Tapping opens the alarm screen itself, not the webview — so alarm
            // interaction never depends on the network.
            .setContentIntent(fullScreen)
            .setFullScreenIntent(fullScreen, true)
            // Not auto-cancel / not dismissible by swipe: a dose alarm should be
            // answered. Answering it is what clears it.
            .setAutoCancel(false)
            .setOngoing(true)
            // On a content-only update this suppresses the re-ring AND the
            // re-launch of the full-screen intent, which is what keeps answering
            // one dose from interrupting the answering of the next.
            .setOnlyAlertOnce(!alertNow)
            .also { b -> localTimeOrNull(scheduledForIso)?.let { b.setSubText(it) } }

        if (many) {
            builder
                .setContentTitle(context.getString(R.string.alarm_group_title, rows.size))
                .setContentText(rows.joinToString(", ") { it.drugName })
                .setStyle(
                    NotificationCompat.InboxStyle().also { style ->
                        rows.forEach { style.addLine(doseLine(it)) }
                    },
                )
                // Three slots, and per-dose answering needs more than three for a
                // handful. So: the one answer that IS honest for a whole handful
                // ("I took them"), the way to answer them individually, and the
                // deferral. Skip-all is deliberately not a one-tap on a lock
                // screen — declining every medicine at once deserves the screen
                // that shows you which ones.
                .addAction(0, context.getString(R.string.alarm_taken_all), groupAction(context, DoseActionReceiver.ACTION_TAKEN, scheduledForIso))
                .addAction(0, context.getString(R.string.alarm_open), fullScreen)
                .addAction(0, context.getString(R.string.alarm_snooze), groupAction(context, DoseActionReceiver.ACTION_SNOOZE, scheduledForIso))
        } else {
            val row = rows.first()
            builder
                .setContentTitle(
                    context.getString(
                        if (isRetry) R.string.alarm_title_retry else R.string.alarm_title,
                        row.drugName,
                    ),
                )
                .setContentText(row.doseLabel ?: context.getString(R.string.alarm_tap_to_open))
                // All three actions straight on the notification. When the phone is
                // unlocked and in use, Android suppresses the full-screen intent and
                // this heads-up notification IS the alarm — so it has to be fully
                // answerable on its own, not a signpost to another screen. Order
                // mirrors the alarm screen's S30 hierarchy: primary, honest decline,
                // deferral last.
                .addAction(0, context.getString(R.string.alarm_taken), singleAction(context, DoseActionReceiver.ACTION_TAKEN, scheduledForIso, row))
                .addAction(0, context.getString(R.string.alarm_skip), singleAction(context, DoseActionReceiver.ACTION_SKIP, scheduledForIso, row))
                .addAction(0, context.getString(R.string.alarm_snooze), singleAction(context, DoseActionReceiver.ACTION_SNOOZE, scheduledForIso, row))
        }

        val manager = context.getSystemService(NotificationManager::class.java) ?: run {
            Log.e(AlarmScheduler.TAG, "NotificationManager unavailable; cannot show dose reminder")
            return
        }

        // Android 14+ gates full-screen intents behind a permission that is
        // auto-granted only to alarm-class apps. If it is ever denied the alarm
        // degrades to a heads-up notification rather than failing — worth
        // knowing which of the two the user is actually getting.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && !manager.canUseFullScreenIntent()) {
            Log.w(
                AlarmScheduler.TAG,
                "USE_FULL_SCREEN_INTENT not granted — alarm will show as a heads-up " +
                    "notification instead of taking over the screen",
            )
        }

        // The single most useful line when "the alarm fired but I saw nothing":
        // on Android 13+ a denied POST_NOTIFICATIONS (or an OEM battery/
        // notification restriction) makes notify() a silent no-op, which is
        // indistinguishable from a broken alarm without this.
        if (!manager.areNotificationsEnabled()) {
            Log.e(
                AlarmScheduler.TAG,
                "ALARM FIRED but notifications are DISABLED for this app at the OS level — " +
                    "notify() will be silently dropped. Check Settings > Apps > Re-MIND-eЯ > Notifications.",
            )
        }

        manager.notify(id, notificationOf(builder))
        // The missed sticky and the live alarm ask the same question; a ringing
        // alarm supersedes its own "not answered" notice.
        manager.cancel(missedGroupId(scheduledForIso, rows.first().medicationId))
        clearLegacyPerMedication(context, rows)
        Log.i(
            AlarmScheduler.TAG,
            "notification $id posted for ${rows.size} dose(s) due $scheduledForIso " +
                "(${rows.joinToString { it.drugName }})",
        )
    }

    private fun notificationOf(builder: NotificationCompat.Builder) = builder.build()

    /**
     * Is a notification with this id already in the shade?
     *
     * Best-effort by design: `activeNotifications` can throw on some OEM builds,
     * and the safe answer to "I could not tell" is **false** — ringing twice is a
     * nuisance, not ringing at all is a missed dose.
     */
    private fun isShowing(context: Context, id: Int): Boolean {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return false
        return runCatching { manager.activeNotifications.any { it.id == id } }.getOrDefault(false)
    }

    // -- MISSED FALLBACK -----------------------------------------------------

    /**
     * Posted when an alarm rings unattended, when a ladder runs out, or when the
     * alarm screen is closed with doses still unanswered.
     *
     * Without this, the auto-timeout path cancelled the alarm notification and
     * left nothing behind — a patient who slept through a dose woke to no trace
     * of it. Losing the reminder is worse than the ringing stopping.
     *
     * Deliberately quiet and non-ringing: no full-screen intent, no sound
     * (IMPORTANCE_LOW channel), so it cannot itself become a battery or
     * attention problem. Tapping it reopens the alarm screen — which is pure
     * native, so the dose can still be recorded with no network.
     *
     * Reads the group itself rather than taking a list, so the three callers
     * cannot each post their own partial version of the same handful. Cancels
     * instead of posting when nothing is outstanding.
     */
    suspend fun showMissedGroup(context: Context, scheduledForIso: String?, fallback: DoseRow? = null) {
        val rows = DosesAtInstant.rowsAt(context, scheduledForIso, fallback)
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (rows.isEmpty()) {
            manager.cancel(missedGroupId(scheduledForIso, fallback?.medicationId ?: 0L))
            return
        }

        ensureMissedChannel(context)
        val many = rows.size > 1

        val reopen = PendingIntent.getActivity(
            context,
            missedGroupId(scheduledForIso, rows.first().medicationId),
            alarmIntent(context, scheduledForIso, rows.first()),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val builder = NotificationCompat.Builder(context, MISSED_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(reopen)
            // Persistent, like the alarm notification it replaces: an unanswered
            // dose should not be clearable with an absent-minded swipe. It stays
            // until the dose is actually resolved. See the class comment for the
            // Android 14+ caveat — a determined user can still dismiss it, and
            // that is fine, because server-side escalation is the real backstop.
            .setAutoCancel(false)
            .setOngoing(true)
            .setOnlyAlertOnce(true)

        // The same actions as the live alarm. These are not optional here: this
        // notification is PERSISTENT, so without a way to answer the dose from
        // it, it would be a permanently stuck notification. Snooze included on
        // purpose — "remind me in 10 minutes" is a perfectly good answer to a
        // dose you slept through.
        if (many) {
            builder
                .setContentTitle(context.getString(R.string.alarm_missed_group_title, rows.size))
                .setContentText(rows.joinToString(", ") { it.drugName })
                .setStyle(
                    NotificationCompat.InboxStyle().also { style ->
                        rows.forEach { style.addLine(doseLine(it)) }
                    },
                )
                .addAction(0, context.getString(R.string.alarm_taken_all), groupAction(context, DoseActionReceiver.ACTION_TAKEN, scheduledForIso))
                .addAction(0, context.getString(R.string.alarm_open), reopen)
                .addAction(0, context.getString(R.string.alarm_snooze), groupAction(context, DoseActionReceiver.ACTION_SNOOZE, scheduledForIso))
        } else {
            val row = rows.first()
            builder
                .setContentTitle(context.getString(R.string.alarm_missed_title, row.drugName))
                .setContentText(
                    listOfNotNull(row.doseLabel, localTimeOrNull(scheduledForIso)?.let { "due $it" })
                        .joinToString(" · ")
                        .ifEmpty { context.getString(R.string.alarm_tap_to_record) },
                )
                .addAction(0, context.getString(R.string.alarm_taken), singleAction(context, DoseActionReceiver.ACTION_TAKEN, scheduledForIso, row))
                .addAction(0, context.getString(R.string.alarm_skip), singleAction(context, DoseActionReceiver.ACTION_SKIP, scheduledForIso, row))
                .addAction(0, context.getString(R.string.alarm_snooze), singleAction(context, DoseActionReceiver.ACTION_SNOOZE, scheduledForIso, row))
        }

        manager.notify(missedGroupId(scheduledForIso, rows.first().medicationId), builder.build())
        clearLegacyPerMedication(context, rows)
        Log.i(
            AlarmScheduler.TAG,
            "posted MISSED fallback for ${rows.size} dose(s) due $scheduledForIso " +
                "(${rows.joinToString { it.drugName }})",
        )
    }

    /** Both notifications for this instant, gone. Used when the whole group is answered or snoozed. */
    fun cancelGroup(context: Context, scheduledForIso: String?, medicationId: Long = 0L) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.cancel(groupId(scheduledForIso, medicationId))
        manager.cancel(missedGroupId(scheduledForIso, medicationId))
        if (medicationId > 0L) {
            manager.cancel(medicationId.toInt())
            manager.cancel((medicationId + 1_000_000L).toInt())
        }
    }

    /**
     * Clear notifications posted by an APK from before group ids existed.
     *
     * `server.url` means the two halves ship separately and a device can carry a
     * live per-medication notification across an update. Nothing new writes those
     * ids, so without this they would be un-cancellable and sit in the shade
     * forever. Cheap and harmless once no device has any left.
     */
    private fun clearLegacyPerMedication(context: Context, rows: List<DoseRow>) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        rows.forEach { row ->
            if (row.medicationId <= 0L) return@forEach
            manager.cancel(row.medicationId.toInt())
            manager.cancel((row.medicationId + 1_000_000L).toInt())
        }
    }

    // -- ACTION INTENTS ------------------------------------------------------

    private fun doseLine(row: DoseRow): String =
        listOfNotNull(row.drugName, row.doseLabel).joinToString(" · ")

    /**
     * A Taken/Skip/Snooze button for ONE dose, handled by [DoseActionReceiver]
     * with no UI at all.
     *
     * PendingIntent equality ignores extras, so without a distinct data URI per
     * (instant, medication, action) the buttons would collapse into one and carry
     * whichever extras were registered first — tapping Skip on one medication
     * would record Taken on another. **The instant is part of the URI**: an
     * unanswered 08:00 sticky and a live 12:00 alarm for the same medication are
     * both on screen at once, and without it the second would silently overwrite
     * the first's dose identity.
     */
    private fun singleAction(
        context: Context,
        action: String,
        scheduledForIso: String?,
        row: DoseRow,
    ): PendingIntent = actionIntent(context, action, scheduledForIso, row, applyToGroup = false)

    /** The same, applied to every dose still unanswered at this instant. */
    private fun groupAction(
        context: Context,
        action: String,
        scheduledForIso: String?,
    ): PendingIntent = actionIntent(context, action, scheduledForIso, null, applyToGroup = true)

    private fun actionIntent(
        context: Context,
        action: String,
        scheduledForIso: String?,
        row: DoseRow?,
        applyToGroup: Boolean,
    ): PendingIntent {
        val slug = action.substringAfterLast('.')
        val minute = epochMinute(scheduledForIso) ?: 0L
        val target = if (applyToGroup) "all" else (row?.medicationId ?: -1L).toString()
        val intent = Intent(context, DoseActionReceiver::class.java).apply {
            this.action = action
            data = Uri.parse("reminderhealth://dose/$minute/$target/$slug")
            putExtra(AlarmScheduler.EXTRA_MEDICATION_ID, row?.medicationId ?: -1L)
            putExtra(AlarmScheduler.EXTRA_DRUG_NAME, row?.drugName)
            // Snooze re-registers a real alarm from this receiver, so it needs
            // everything AlarmScheduler.scheduleAt would otherwise read from the
            // store — including the voice/photo paths, or a snoozed alarm would
            // silently lose the family voice message the first one had.
            putExtra(AlarmScheduler.EXTRA_DOSE_LABEL, row?.doseLabel)
            putExtra(AlarmScheduler.EXTRA_SCHEDULED_FOR, scheduledForIso)
            putExtra(AlarmScheduler.EXTRA_AUDIO_PATH, row?.audioPath)
            putExtra(AlarmScheduler.EXTRA_PHOTO_PATH, row?.photoPath)
            putExtra(DoseActionReceiver.EXTRA_APPLY_TO_GROUP, applyToGroup)
        }
        return PendingIntent.getBroadcast(
            context,
            (ACTION_REQUEST_CODE_BASE + minute % 1_000_000L + slug.hashCode() + (row?.medicationId ?: 0L)).toInt(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** Shared by the alarm notification and the missed fallback. */
    private fun alarmIntent(
        context: Context,
        scheduledForIso: String?,
        seed: DoseRow,
    ): Intent = Intent(context, AlarmActivity::class.java).apply {
        // NEW_TASK only. FLAG_ACTIVITY_CLEAR_TASK was here and had to go: it
        // clears the task the activity lands in, and on 2026-08-11 the app
        // would not reopen at all after an alarm was answered — a cleared
        // task record the launcher still resolved to. The alarm needs its own
        // task (taskAffinity="" in the manifest handles that); it has no
        // business clearing anything, and nothing is ever stacked under it.
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        // Keyed on the INSTANT, not the medication: one alarm screen per handful.
        data = Uri.parse("reminderhealth://alarm/${epochMinute(scheduledForIso) ?: seed.medicationId}")
        putExtra(AlarmScheduler.EXTRA_MEDICATION_ID, seed.medicationId)
        putExtra(AlarmScheduler.EXTRA_DRUG_NAME, seed.drugName)
        putExtra(AlarmScheduler.EXTRA_DOSE_LABEL, seed.doseLabel)
        putExtra(AlarmScheduler.EXTRA_SCHEDULED_FOR, scheduledForIso)
        putExtra(AlarmScheduler.EXTRA_AUDIO_PATH, seed.audioPath)
        putExtra(AlarmScheduler.EXTRA_PHOTO_PATH, seed.photoPath)
    }

    /**
     * The dose's scheduled instant as a readable LOCAL time ("2:35 AM").
     *
     * Everything on the wire is ISO-8601 UTC (`2026-08-10T21:05:00Z`) because
     * that is the only unambiguous way to carry an instant — but showing that
     * raw to a patient is useless, and worse, off by the UTC offset so it looks
     * like the alarm fired at the wrong time. Matches how AlarmActivity formats
     * the same value, so the notification and the alarm screen never disagree.
     */
    private fun localTimeOrNull(iso: String?): String? {
        if (iso == null) return null
        return runCatching {
            DateTimeFormatter.ofPattern("h:mm a")
                .withZone(ZoneId.systemDefault())
                .format(Instant.parse(iso))
        }.getOrNull()
    }
}
