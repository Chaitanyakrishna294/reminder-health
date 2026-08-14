package com.reminderhealth.app.schedule

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.reminderhealth.app.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * The full-screen dose alarm — the moment the whole product exists for.
 *
 * Launched by the notification's **full-screen intent** (never
 * `SYSTEM_ALERT_WINDOW`, which CLAUDE.md forbids and which draws Play Store
 * scrutiny). Pure native: it reads its content from the local Room store and the
 * intent extras, so it works with no network and without the webview ever
 * starting.
 *
 * ## ONE SCREEN PER HANDFUL (the coalesced ring, 2026-08-14)
 *
 * Doses at the same instant are asked about together and answered
 * independently. Four medications at 12:00 previously produced four alarms; on a
 * real device two fought for the full screen while the other two sat in the
 * shade. Now the notification carries one id per dose instant and this activity
 * is `singleInstance`, so there is exactly one screen, and it asks
 * [DosesAtInstant] who is still waiting rather than trusting whichever alarm
 * happened to arrive first.
 *
 * Three properties this leans on, each load-bearing:
 *
 *  - **The group is derived from the SCHEDULE, not from alarm state.** A retry
 *    rung, a rung rebuilt after a reboot, and the original ring all compute the
 *    same group, so a rung joins its handful without knowing the handful exists.
 *  - **Answering is per dose and the screen persists.** An answered row turns
 *    into a confirmation and stays; the screen closes only when nothing is left.
 *  - **Closing with doses unanswered marks ONLY those doses unattended.** Their
 *    ladders keep running and their missed notice posts; the answered ones are
 *    answered. See [dismissUnattended].
 *
 * **Elderly asks one question at a time** ([AlarmPrefs.isElderly]) — the doses
 * are all still outstanding, the screen just shows them one at a time. That is
 * presentation only, the same split `ElderlyToday` keeps on the web.
 *
 * **No wake lock, deliberately.** CLAUDE.md's rule is "any wake lock must be
 * released the moment the alarm is dismissed or auto-times-out" — the cleanest
 * way to honour that is to hold none at all. An earlier version acquired a
 * PARTIAL_WAKE_LOCK and crashed on launch (`SecurityException: ...has
 * android.permission.WAKE_LOCK`, 2026-08-11) because the permission is not
 * declared, and it should stay undeclared: the wake lock was redundant.
 * `setTurnScreenOn` + `FLAG_KEEP_SCREEN_ON` already wake the display and hold
 * it on while this activity is visible, and a lit screen keeps the CPU running
 * — so the sound plays with no lock, no permission, and nothing that *can* leak.
 * (Between the alarm firing and this activity starting, the system holds its own
 * temporary lock for the broadcast, so there is no gap either.)
 *
 * Lifecycle discipline:
 *  - [releaseEverything] is called from every exit path (all doses answered,
 *    timeout, onDestroy) and is idempotent; it stops the looping audio and
 *    vibration, which ARE things that would otherwise outlive the screen;
 *  - `FLAG_KEEP_SCREEN_ON` is dropped by the OS when the window goes away;
 *  - no service, no repeating alarm, nothing survives this screen.
 */
class AlarmActivity : Activity() {

    companion object {
        /** Mirrors src/constants.js SNOOZE_MINUTES so device and bot agree. */
        const val SNOOZE_MINUTES = 10

        /**
         * Auto-dismiss after this long without a tap. Matches CLAUDE.md's ~60s
         * figure. An unanswered dose is NOT resolved here — the server pipeline
         * still owns missed-dose escalation, exactly as it does for web-only
         * users.
         *
         * **Re-armed on every answer.** A handful of four takes longer to answer
         * than one dose does, and someone who has just tapped Taken is
         * demonstrably present; timing them out mid-handful would leave the rest
         * of the doses unasked with the patient standing right there. The window
         * only ever counts silence.
         */
        private const val AUTO_DISMISS_MS = 60_000L

        /** How long an answered dose's confirmation is shown before elderly advances. */
        private const val ELDERLY_ADVANCE_MS = 900L

        /** How long "All done" stays up before the screen closes itself. */
        private const val ALL_DONE_MS = 1_100L
    }

    private var player: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private val handler = Handler(Looper.getMainLooper())
    private val scope = MainScope()
    private var released = false
    private var closing = false

    /** The dose instant this screen is asking about — the group's identity. */
    private var doseInstantIso: String? = null

    /**
     * The dose the firing alarm itself carried. Kept as the fallback for
     * [DosesAtInstant.rowsAt] so an alarm whose medication has since been edited
     * out of this instant still gets asked rather than silently swallowed.
     */
    private var seed: DoseRow? = null

    /** Every dose known at this instant, stable order, answered or not. */
    private var allRows: List<DoseRow> = emptyList()

    /** medicationId → the action recorded for it, or null when answered elsewhere. */
    private val answered = LinkedHashMap<Long, String?>()

    private var elderly = false

    /**
     * Family voice alarms (CLAUDE.md "Post-M2 features"). Null until that
     * feature ships; both are LOCAL paths, verified readable before use, so a
     * missing or deleted file falls back instead of breaking the alarm. For a
     * handful, the first dose's personalisation stands for the group — one
     * voice, one photo, one alarm.
     */
    private var audioFile: File? = null
    private var photoFile: File? = null

    /**
     * A dose at this instant was just answered somewhere else — the
     * notification's buttons ([DoseActionReceiver]), or the webview
     * ([ScheduleBridgePlugin.doseResolved], which is how a caregiver's remote
     * answer reaches the device).
     *
     * The screen REFRESHES rather than closing: one dose of four being answered
     * elsewhere must not take the other three off the screen. It closes only
     * when the refresh finds nothing left, which is the same rule every other
     * path uses.
     */
    private val answeredElsewhere = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val instant = intent?.getStringExtra(AlarmScheduler.EXTRA_SCHEDULED_FOR)
            if (instant != null && instant != doseInstantIso) return
            Log.i(AlarmScheduler.TAG, "a dose due $doseInstantIso was answered elsewhere; refreshing the alarm screen")
            refreshFromStore()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        showOverLockScreen()
        setContentView(R.layout.activity_alarm)

        // NOT_EXPORTED: this is an in-process signal only. An exported receiver
        // would let any app on the device silence a medication alarm.
        ContextCompat.registerReceiver(
            this,
            answeredElsewhere,
            IntentFilter(DoseActionReceiver.ACTION_ANSWERED),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )

        findViewById<Button>(R.id.alarm_snooze).setOnClickListener { snoozeRemaining() }

        startFor(intent)
    }

    /**
     * Another full-screen intent arrived while this screen was up.
     *
     * Same instant (a second medication in the handful, or a retry rung) → just
     * re-read the group. `singleInstance` is what routes it here instead of
     * stacking a second alarm screen, and it is the whole reason four
     * simultaneous alarms can no longer fight for the display.
     *
     * DIFFERENT instant → the newer dose takes over, and the one being replaced
     * is retired honestly: its remaining doses get their missed notice and their
     * ladders keep running. Leaving the old dose on screen while a new alarm
     * rings underneath it is the failure this whole change exists to remove.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val incoming = intent.getStringExtra(AlarmScheduler.EXTRA_SCHEDULED_FOR)
        setIntent(intent)

        if (incoming != null && incoming == doseInstantIso) {
            refreshFromStore()
            return
        }

        Log.i(AlarmScheduler.TAG, "alarm screen handing over from dose $doseInstantIso to $incoming")
        postMissedForRemainder()
        startFor(intent)
    }

    /** Read the intent, reset every piece of per-dose state, and start ringing. */
    private fun startFor(intent: Intent) {
        val medicationId = intent.getLongExtra(AlarmScheduler.EXTRA_MEDICATION_ID, -1L)
        doseInstantIso = intent.getStringExtra(AlarmScheduler.EXTRA_SCHEDULED_FOR)
        audioFile = readableFileOrNull(intent.getStringExtra(AlarmScheduler.EXTRA_AUDIO_PATH), "audio")
        photoFile = readableFileOrNull(intent.getStringExtra(AlarmScheduler.EXTRA_PHOTO_PATH), "photo")
        seed = DoseRow(
            medicationId = medicationId,
            drugName = intent.getStringExtra(AlarmScheduler.EXTRA_DRUG_NAME) ?: getString(R.string.alarm_tap_to_open),
            doseLabel = intent.getStringExtra(AlarmScheduler.EXTRA_DOSE_LABEL),
            audioPath = audioFile?.absolutePath,
            photoPath = photoFile?.absolutePath,
        )

        elderly = AlarmPrefs.isElderly(this)
        answered.clear()
        allRows = listOfNotNull(seed)
        closing = false

        Log.i(
            AlarmScheduler.TAG,
            "AlarmActivity shown for the dose due $doseInstantIso, seeded with med $medicationId " +
                "[voice=${audioFile != null}, photo=${photoFile != null}, elderly=$elderly]",
        )

        bindChrome()
        render()
        startRinging()

        // The seed is one dose; the handful may be four. Ask the store who else
        // is waiting at this instant and re-render — always, because the seed is
        // also the ONLY thing known if that read fails.
        refreshFromStore()
    }

    // -- THE GROUP -----------------------------------------------------------

    /**
     * Re-read who is still waiting and re-render.
     *
     * Merges rather than replaces: a dose that has dropped out of the store's
     * unanswered set has been ANSWERED (here, on the notification, or on the
     * web), so it becomes a confirmation row instead of disappearing from a list
     * the patient is working through.
     */
    private fun refreshFromStore() {
        val instant = doseInstantIso
        val fallback = seed
        scope.launch {
            val outstanding = DosesAtInstant.rowsAt(applicationContext, instant, fallback)
            if (instant != doseInstantIso) return@launch // a newer dose took over mid-read
            val outstandingIds = outstanding.map { it.medicationId }.toSet()

            allRows = (allRows + outstanding).distinctBy { it.medicationId }.sortedBy { it.medicationId }
            allRows.forEach { row ->
                if (row.medicationId !in outstandingIds && !answered.containsKey(row.medicationId)) {
                    // Answered somewhere this screen did not see, so the outcome
                    // is unknown to it — say "recorded", never guess Taken.
                    answered[row.medicationId] = null
                }
            }

            if (outstanding.isEmpty()) allAnswered() else render()
        }
    }

    private fun outstandingRows(): List<DoseRow> = allRows.filter { !answered.containsKey(it.medicationId) }

    // -- RENDERING -----------------------------------------------------------

    private fun bindChrome() {
        bindPhoto()

        // Eyebrow shows the dose's own scheduled LOCAL time, not "now" — if the
        // phone was asleep and the alarm is a moment late, the honest answer is
        // when the dose was due.
        val whenText = doseInstantIso?.let { iso ->
            runCatching {
                DateTimeFormatter.ofPattern("h:mm a")
                    .withZone(ZoneId.systemDefault())
                    .format(Instant.parse(iso))
            }.getOrNull()
        }
        findViewById<TextView>(R.id.alarm_eyebrow).text = if (whenText != null) {
            "${getString(R.string.alarm_eyebrow_prefix)} · $whenText"
        } else {
            getString(R.string.alarm_eyebrow_prefix)
        }
    }

    private fun render() {
        val list = findViewById<LinearLayout>(R.id.alarm_dose_list)
        list.removeAllViews()

        val outstanding = outstandingRows()
        val total = allRows.size
        // ELDERLY IS THE ONLY DENSITY THAT NARROWS THE SCREEN, and it narrows
        // presentation only: every dose is still outstanding, still laddering,
        // still answerable — it is asked about one at a time.
        val visible = if (elderly) outstanding.take(1) else outstanding
        val solo = elderly || total <= 1

        val count = findViewById<TextView>(R.id.alarm_group_count)
        when {
            total <= 1 -> count.visibility = View.GONE
            elderly -> {
                count.text = getString(R.string.alarm_group_progress, answered.size + 1, total)
                count.visibility = View.VISIBLE
            }
            else -> {
                count.text = getString(R.string.alarm_group_count, total)
                count.visibility = View.VISIBLE
            }
        }

        val inflater = LayoutInflater.from(this)

        // Confirmations first and in place, so the handful reads top-to-bottom as
        // "done, done, still to do" rather than reshuffling under a thumb.
        if (!elderly) {
            allRows.filter { answered.containsKey(it.medicationId) }.forEach { row ->
                list.addView(answeredView(inflater, list, row, answered[row.medicationId]))
            }
        }

        visible.forEach { row ->
            list.addView(doseView(inflater, list, row, solo))
        }

        findViewById<Button>(R.id.alarm_snooze).visibility =
            if (outstanding.isEmpty()) View.GONE else View.VISIBLE
    }

    /**
     * One actionable dose. [solo] picks the layout, and that is the entire
     * difference between the two presentations — the ids and this binding are
     * shared, so a group row and a single dose can never grow different
     * behaviour.
     */
    private fun doseView(inflater: LayoutInflater, parent: ViewGroup, row: DoseRow, solo: Boolean): View {
        val view = inflater.inflate(
            if (solo) R.layout.alarm_dose_solo else R.layout.alarm_dose_grouped,
            parent,
            false,
        )
        if (solo) {
            // The solo dose owns the whole scroll area, which is what lets its
            // identity block absorb the slack and its action band stay pinned
            // low — the geometry verified on device 2026-08-11. The ScrollView's
            // fillViewport is the other half: it stretches the list to the
            // viewport, so MATCH_PARENT here resolves to a full screen rather
            // than to the height of the text.
            view.layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.MATCH_PARENT,
            )
        }
        view.findViewById<TextView>(R.id.dose_name).text = row.drugName
        view.findViewById<TextView>(R.id.dose_amount).apply {
            text = row.doseLabel ?: ""
            visibility = if (row.doseLabel.isNullOrBlank()) View.GONE else View.VISIBLE
        }
        view.findViewById<Button>(R.id.dose_taken).setOnClickListener { answer(row, DoseAction.ACTION_TAKEN) }
        view.findViewById<Button>(R.id.dose_skip).setOnClickListener { answer(row, DoseAction.ACTION_SKIP) }

        if (photoFile != null) {
            val onPhoto = Color.WHITE
            view.findViewById<TextView>(R.id.dose_name).setTextColor(onPhoto)
            view.findViewById<TextView>(R.id.dose_amount).setTextColor(onPhoto)
        }
        return view
    }

    private fun answeredView(inflater: LayoutInflater, parent: ViewGroup, row: DoseRow, action: String?): View {
        val view = inflater.inflate(R.layout.alarm_dose_answered, parent, false)
        view.findViewById<TextView>(R.id.dose_verdict).text = when (action) {
            DoseAction.ACTION_TAKEN -> getString(R.string.alarm_recorded_taken)
            DoseAction.ACTION_SKIP -> getString(R.string.alarm_recorded_skipped)
            else -> getString(R.string.alarm_recorded)
        }
        view.findViewById<TextView>(R.id.dose_name).text = row.drugName
        return view
    }

    /**
     * Shows the care-circle photo full-screen when one is present, and flips the
     * text to white over the scrim so it stays readable against an arbitrary
     * photo. With no photo, nothing changes — the default alarm keeps its own
     * light palette.
     */
    private fun bindPhoto() {
        val file = photoFile
        val photo = findViewById<ImageView>(R.id.alarm_photo)
        val scrim = findViewById<View>(R.id.alarm_photo_scrim)
        if (file == null) {
            photo.visibility = View.GONE
            scrim.visibility = View.GONE
            return
        }

        val bitmap = runCatching { BitmapFactory.decodeFile(file.absolutePath) }.getOrNull()
        if (bitmap == null) {
            Log.w(AlarmScheduler.TAG, "photo at ${file.absolutePath} could not be decoded — using default")
            photoFile = null
            return
        }

        photo.setImageBitmap(bitmap)
        photo.visibility = View.VISIBLE
        scrim.visibility = View.VISIBLE

        val onPhoto = Color.WHITE
        findViewById<TextView>(R.id.alarm_eyebrow).setTextColor(onPhoto)
        findViewById<TextView>(R.id.alarm_group_count).setTextColor(onPhoto)
    }

    /**
     * A path is only usable if the file is actually there and readable — the
     * alarm must never wait on a download or show a broken frame, so anything
     * unverifiable degrades to the default immediately and says so in the log.
     */
    private fun readableFileOrNull(path: String?, kind: String): File? {
        if (path.isNullOrBlank()) return null
        val file = File(path)
        if (file.isFile && file.canRead() && file.length() > 0L) return file
        Log.w(AlarmScheduler.TAG, "local alarm $kind missing/unreadable at $path — using default")
        return null
    }

    // -- ANSWERING -----------------------------------------------------------

    /**
     * Taken / Skip for ONE dose. The other doses in the handful are untouched:
     * their ladders keep running, their rows stay on screen, and the alarm keeps
     * ringing until the last one is answered.
     */
    private fun answer(row: DoseRow, action: String) {
        if (answered.containsKey(row.medicationId)) return
        answered[row.medicationId] = action
        enqueue(row, action)

        // The person is demonstrably here, so the silence timer starts again.
        armAutoDismiss()

        if (outstandingRows().isEmpty()) {
            allAnswered()
            return
        }

        if (elderly) {
            // One question at a time: show what was just recorded, then the next
            // dose. Advancing instantly would make four taps feel like one
            // mis-registered tap.
            showElderlyConfirmationThenAdvance(row, action)
        } else {
            render()
        }
    }

    private fun showElderlyConfirmationThenAdvance(row: DoseRow, action: String) {
        val list = findViewById<LinearLayout>(R.id.alarm_dose_list)
        list.removeAllViews()
        list.addView(answeredView(LayoutInflater.from(this), list, row, action))
        findViewById<Button>(R.id.alarm_snooze).visibility = View.GONE
        handler.postDelayed({ if (!closing) render() }, ELDERLY_ADVANCE_MS)
    }

    /**
     * Every dose in the handful is answered. Stop ringing immediately, show it,
     * and close.
     *
     * The notification is cleared by [DoseActionQueue.record], which every answer
     * — including one made on the notification or on the web — passes through.
     * Doing it there rather than here is what keeps "the group is empty" meaning
     * the same thing on both surfaces.
     */
    private fun allAnswered() {
        if (closing) return
        closing = true
        releaseEverything()

        findViewById<LinearLayout>(R.id.alarm_dose_list).removeAllViews()
        findViewById<TextView>(R.id.alarm_group_count).visibility = View.GONE
        findViewById<Button>(R.id.alarm_snooze).visibility = View.GONE
        findViewById<TextView>(R.id.alarm_all_done).visibility = View.VISIBLE

        Log.i(AlarmScheduler.TAG, "every dose due $doseInstantIso is answered; closing the alarm screen")
        handler.postDelayed({ finish() }, ALL_DONE_MS)
    }

    /**
     * Snooze does two independent things for every dose still unanswered, and
     * both must happen:
     *  - reschedules THIS device's alarm, so the patient is asked again;
     *  - queues a server-side snooze, so `reminder_events.retry_reminder_at`
     *    moves and the care circle is NOT told the dose was missed. A
     *    device-only snooze would produce a false escalation alert — which is
     *    why `snooze_reminder_event` exists at all.
     *
     * ONE BUTTON FOR THE HANDFUL, and only for what is still outstanding.
     * "Not now" means the same thing whether it covers one medicine or four, and
     * a dose already answered is not un-answered by deferring the rest.
     */
    private fun snoozeRemaining() {
        val remaining = outstandingRows()
        if (remaining.isEmpty()) return

        val fireAt = Instant.now().plusSeconds(SNOOZE_MINUTES * 60L)
        // The re-fire is 10 minutes out, but it still asks about THESE doses, so
        // it must carry the ORIGINAL scheduled instant — that is what the server
        // resolves against. See scheduleAt's `scheduledFor` doc for what
        // conflating the two broke.
        val doseInstant = doseInstantIso?.let { runCatching { Instant.parse(it) }.getOrNull() }

        remaining.forEach { row ->
            if (row.medicationId <= 0L) return@forEach
            AlarmScheduler.scheduleAt(
                context = this,
                medicationId = row.medicationId,
                drugName = row.drugName,
                doseLabel = row.doseLabel,
                fireAt = fireAt,
                audioPath = row.audioPath,
                photoPath = row.photoPath,
                scheduledFor = doseInstant ?: fireAt,
            )
            enqueue(row, DoseAction.ACTION_SNOOZE, snoozeFireAt = fireAt)
        }
        Log.i(
            AlarmScheduler.TAG,
            "snoozed ${remaining.size} dose(s) due $doseInstantIso by $SNOOZE_MINUTES min",
        )

        closing = true
        releaseEverything()
        finish()
    }

    /**
     * Writes the action to the local queue, then asks WorkManager to drain it.
     *
     * Local write first, always: if the network is down, the process is killed,
     * or the phone reboots before it syncs, the tap survives. A discarded
     * "Taken" is a patient telling the app something and the app forgetting —
     * data loss in a medication record, not a missing nicety.
     *
     * Fire-and-forget on a background scope rather than blocking the tap: the
     * row must confirm instantly, and the queue plus WorkManager already
     * guarantee delivery without this Activity being alive.
     */
    private fun enqueue(row: DoseRow, action: String, snoozeFireAt: Instant? = null) {
        val appContext = applicationContext
        val scheduled = doseInstantIso
        val snoozeMinutes = if (action == DoseAction.ACTION_SNOOZE) SNOOZE_MINUTES else null

        CoroutineScope(Dispatchers.IO).launch {
            // Shared with DoseActionReceiver (the notification's Taken/Skip/Snooze
            // buttons) and with the webview bridge, so every answer path records
            // identically and cancels the retry ladder identically.
            DoseActionQueue.record(
                context = appContext,
                medicationId = row.medicationId,
                drugName = row.drugName,
                scheduledFor = scheduled,
                action = action,
                snoozeMinutes = snoozeMinutes,
                snoozeFireAt = snoozeFireAt,
            )
        }
    }

    // -- LEAVING -------------------------------------------------------------

    /**
     * Nobody answered — auto-timeout, or the alarm stopped being visible.
     *
     * Crucially this does NOT just cancel the notification and vanish, which is
     * what the old dismiss()-on-timeout did: a patient who slept through a dose
     * woke to no trace of it at all. The ringing alarm notification is replaced
     * with a quiet, persistent "Missed" notice so the reminder survives.
     *
     * **Only the doses still unanswered are affected.** Answering two of four
     * and walking away leaves those two answered and the other two chased — the
     * unanswered ones keep their ladders and get the missed notice, and nothing
     * re-opens a question the patient already closed.
     *
     * Those doses are deliberately left UNRESOLVED — the server pipeline still
     * owns missed-dose escalation, exactly as it does for web-only users.
     * Recording a silent outcome here would hide a missed dose from the care
     * circle.
     */
    private fun dismissUnattended() {
        releaseEverything()
        postMissedForRemainder()
        finish()
    }

    /**
     * Posts the missed notice for whatever is still outstanding at this instant,
     * or clears it when nothing is. Reads the store rather than this screen's
     * state so a dose answered on the notification a moment ago is not chased.
     */
    private fun postMissedForRemainder() {
        val instant = doseInstantIso ?: return
        val fallback = seed
        // applicationContext + a detached scope: this runs as the activity is
        // going away, and the notification must outlive it.
        CoroutineScope(Dispatchers.IO).launch {
            runCatching { DoseNotifications.showMissedGroup(applicationContext, instant, fallback) }
                .onFailure { Log.e(AlarmScheduler.TAG, "could not post the missed notice for $instant", it) }
        }
    }

    /** Turns the screen on and draws over the keyguard without any extra permission. */
    private fun showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        Log.i(
            AlarmScheduler.TAG,
            "ALARM SCREEN-ON ACQUIRED (keep-screen-on set; NO wake lock — the lit screen keeps the " +
                "CPU up, and this flag dies with the window so it cannot outlive the alarm)",
        )
    }

    /** Sound, vibration and the silence timer — re-armable, for the hand-over case. */
    private fun startRinging() {
        released = false
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        startAlarmSound()
        startVibration()
        armAutoDismiss()
    }

    private fun armAutoDismiss() {
        handler.removeCallbacksAndMessages(null)
        // Unattended-alarm safety net. postDelayed on the MAIN looper is correct
        // here specifically because this activity keeps the screen on:
        // uptimeMillis (which postDelayed uses) only stalls in deep sleep, and
        // the device cannot be in deep sleep while this window is visible. So the
        // timeout is guaranteed to run — including over the lock screen, which is
        // just a normal visible window as far as the looper is concerned.
        handler.postDelayed({
            Log.i(AlarmScheduler.TAG, "alarm auto-dismissed after ${AUTO_DISMISS_MS}ms of silence")
            dismissUnattended()
        }, AUTO_DISMISS_MS)
    }

    private fun startAlarmSound() {
        if (player != null) return
        // A care-circle voice recording wins over the default tone when one is
        // on disk. Local file only — never a stream, so this works in airplane
        // mode (CLAUDE.md's non-negotiable for the voice feature).
        val localVoice = audioFile
        val uri = if (localVoice != null) {
            Uri.fromFile(localVoice)
        } else {
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
                ?: return
        }
        player = runCatching {
            MediaPlayer().apply {
                setDataSource(this@AlarmActivity, uri)
                // USAGE_ALARM routes to the alarm stream, so it is audible even
                // when the ringer is silenced — correct for a medication alarm.
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                isLooping = true
                prepare()
                start()
            }
        }.onFailure { Log.e(AlarmScheduler.TAG, "could not start alarm sound", it) }.getOrNull()
    }

    private fun startVibration() {
        if (vibrator != null) return
        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (getSystemService(VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(VIBRATOR_SERVICE) as? Vibrator
        }
        val pattern = longArrayOf(0, 600, 800)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
        } else {
            @Suppress("DEPRECATION")
            vibrator?.vibrate(pattern, 0)
        }
    }

    /** Idempotent — safe from any exit path, and called from all of them. */
    private fun releaseEverything() {
        if (released) return
        released = true

        handler.removeCallbacksAndMessages(null)

        runCatching { player?.stop() }
        runCatching { player?.release() }
        player = null

        runCatching { vibrator?.cancel() }
        vibrator = null

        // Explicitly drop keep-screen-on rather than relying on the window
        // teardown to do it. This is THE power-relevant resource this screen
        // holds (there is no wake lock — see the class comment), so it gets an
        // explicit, greppable release line to verify on device.
        runCatching { window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }

        Log.i(
            AlarmScheduler.TAG,
            "ALARM SCREEN-ON RELEASED (keep-screen-on cleared, sound stopped, vibration cancelled; " +
                "no wake lock is ever held by this screen)",
        )
    }

    /**
     * If the alarm is no longer visible it must not keep ringing — the user may
     * have hit the power button, or another window took over. Treated as
     * unattended so the missed notice is posted for whatever is still
     * outstanding, rather than the reminder silently disappearing.
     *
     * releaseEverything() is idempotent, so the onStop that happens during a
     * normal finish() is a harmless no-op.
     */
    override fun onStop() {
        if (!released) {
            Log.i(AlarmScheduler.TAG, "alarm no longer visible (onStop) — treating the rest as unattended")
            dismissUnattended()
        }
        super.onStop()
    }

    override fun onDestroy() {
        releaseEverything()
        runCatching { unregisterReceiver(answeredElsewhere) }
        scope.cancel()
        super.onDestroy()
    }

    /**
     * Back is deliberately inert: an alarm should be answered, not swiped away
     * by accident while half asleep. The 60s auto-dismiss is the escape hatch,
     * so this can never trap anyone.
     */
    @Deprecated("Activity.onBackPressed is deprecated; intentional no-op for an alarm screen")
    override fun onBackPressed() {
        // no-op
    }
}
