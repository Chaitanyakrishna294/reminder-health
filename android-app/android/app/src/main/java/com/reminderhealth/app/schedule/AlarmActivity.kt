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
 * ## THE FOCUSED LIST (2026-08-14)
 *
 * Doses at the same instant are one handful, and the whole handful is on screen —
 * but only ONE dose is being asked about at a time. The focused dose rings with
 * big Taken / Skip; the rest sit below it showing their state, and any of them
 * can be tapped to jump the queue. Answering advances the focus. So does running
 * out of ring time, which **yields**: that dose stops taking the screen's
 * attention without being resolved, so its ladder and its missed notice carry on
 * exactly as if the screen had never opened. When every dose has had its turn,
 * the screen closes.
 *
 * The alternative — four cards each with two buttons — is eight equal choices at
 * 3am, and the earlier version of it also let one unanswered dose hold the screen
 * while the other three were never asked at all.
 *
 * The rotation itself lives in [DoseFocus], not here: a dose quietly dropped from
 * it is a dose never asked about, and on screen that is indistinguishable from a
 * dose that was never due. An Activity cannot be unit-tested; three sets can.
 *
 * Two properties this leans on, both load-bearing:
 *
 *  - **The group is derived from the SCHEDULE, not from alarm state**
 *    ([DosesAtInstant]). A retry rung, a rung rebuilt after a reboot, and the
 *    original ring all compute the same handful, so a rung arriving mid-screen
 *    re-presents exactly the still-unanswered subset without knowing anything
 *    about what this screen has been doing.
 *  - **Closing with doses unanswered marks ONLY those doses unattended.** The
 *    missed notice re-reads the store, so answered doses are never chased.
 *
 * **Elderly reduces the list to the focused dose alone** ([AlarmPrefs.isElderly])
 * — the same one-question rule `ElderlyToday` keeps on the web. Same mechanism,
 * fewer elements: every dose is still outstanding and still laddering.
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
 *  - [releaseEverything] is called from every exit path and is idempotent; it
 *    stops the looping audio and vibration, which ARE things that would otherwise
 *    outlive the screen;
 *  - `FLAG_KEEP_SCREEN_ON` is dropped by the OS when the window goes away;
 *  - no service, no repeating alarm, nothing survives this screen.
 */
class AlarmActivity : Activity() {

    companion object {
        /** Mirrors src/constants.js SNOOZE_MINUTES so device and bot agree. */
        const val SNOOZE_MINUTES = 10

        /** How long an answered dose's confirmation is shown before the focus moves on. */
        private const val ADVANCE_MS = 800L

        /** How long "All done" stays up before the screen closes itself. */
        private const val ALL_DONE_MS = 1_100L
    }

    private var player: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private val handler = Handler(Looper.getMainLooper())
    private val scope = MainScope()
    private var released = false
    private var closing = false

    /** The dose instant this screen is asking about — the handful's identity. */
    private var doseInstantIso: String? = null

    /**
     * The dose the firing alarm itself carried. Kept as the fallback for
     * [DosesAtInstant.rowsAt] so an alarm whose medication has since been edited
     * out of this instant still gets asked rather than silently swallowed.
     */
    private var seed: DoseRow? = null

    /** Every dose known at this instant, keyed by medication id. */
    private var rows: Map<Long, DoseRow> = emptyMap()

    /** Who is being asked, who has answered, who has had their turn. */
    private val focus = DoseFocus()

    private var elderly = false

    /**
     * How long each dose rings before yielding. **Per dose, not per screen** — a
     * handful of four at two minutes each can run for eight, which is why the
     * setting's copy says "each medicine rings this long" rather than hiding the
     * arithmetic. Bridged from the web ([AlarmPrefs.ringSeconds]); 60s until a
     * sync says otherwise, which is the behaviour every existing device has.
     */
    private var ringMs = AlarmPrefs.RING_SECONDS_DEFAULT * 1000L

    /**
     * The backdrop and the sound belong to the ALARM, not to a row.
     *
     * A handful gets ONE picture and ONE tone: swapping either as the focus moves
     * down the list would make the screen flicker and the sound stutter at the
     * exact moment someone is trying to read a medicine name. Resolved once, in
     * [startFor], and then left alone.
     *
     * Both are LOCAL — app-private storage, never a URL — so the alarm shows and
     * plays them in airplane mode with the process dead. See [AlarmMedia].
     */
    private var backdrop: AlarmMedia.Image = AlarmMedia.Image.None

    /**
     * True when a backdrop actually RENDERED — the binder's return value, not a
     * test of which choice is set. A picked photo that fails to decode falls back
     * to no backdrop, and content that assumed otherwise would be white text on a
     * light ground.
     */
    private var onPhoto: Boolean = false

    /**
     * A dose at this instant was answered somewhere else — the notification's
     * buttons ([DoseActionReceiver]), or the webview
     * ([ScheduleBridgePlugin.doseResolved], which is how a caregiver's remote
     * answer reaches the device).
     *
     * The screen REFRESHES rather than closing: one dose of four being answered
     * elsewhere must not take the other three off the screen.
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
     * Same instant — a second medication in the handful, or a **retry rung** —
     * re-reads the group. `singleInstance` is what routes it here instead of
     * stacking a second alarm screen, and it is the whole reason four
     * simultaneous alarms can no longer fight for the display.
     *
     * A rung also un-yields the dose it is about. That is the point of a rung:
     * the ladder promised to ask again, and a dose that already had its turn on
     * this screen would otherwise be re-presented as still-unanswered but never
     * actually asked.
     *
     * DIFFERENT instant → the newer dose takes over, and the one being replaced
     * is retired honestly: its remaining doses get their missed notice and their
     * ladders keep running.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val incoming = intent.getStringExtra(AlarmScheduler.EXTRA_SCHEDULED_FOR)
        setIntent(intent)

        if (incoming != null && incoming == doseInstantIso) {
            val ringingFor = intent.getLongExtra(AlarmScheduler.EXTRA_MEDICATION_ID, -1L)
            if (ringingFor > 0L && ringingFor !in focus.answered) {
                Log.i(AlarmScheduler.TAG, "a rung for med $ringingFor arrived mid-screen; giving it the focus")
                focus.focusOn(ringingFor)
                armRingWindow()
            }
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
        seed = DoseRow(
            medicationId = medicationId,
            drugName = intent.getStringExtra(AlarmScheduler.EXTRA_DRUG_NAME) ?: getString(R.string.alarm_tap_to_open),
            doseLabel = intent.getStringExtra(AlarmScheduler.EXTRA_DOSE_LABEL),
            audioPath = intent.getStringExtra(AlarmScheduler.EXTRA_AUDIO_PATH),
            photoPath = intent.getStringExtra(AlarmScheduler.EXTRA_PHOTO_PATH),
        )
        // The per-medication paths carried by the alarm are the OVERRIDE slot and
        // are null in this phase; AlarmMedia falls through to the user's global
        // choice, then to no backdrop / the system tone.
        backdrop = AlarmMedia.resolveImage(this, seed?.photoPath)

        elderly = AlarmPrefs.isElderly(this)
        ringMs = AlarmPrefs.ringSeconds(this) * 1000L
        rows = seed?.let { mapOf(it.medicationId to it) } ?: emptyMap()
        focus.answered.clear()
        focus.yielded.clear()
        focus.setOrder(rows.keys.toList())
        focus.advance()
        closing = false
        confirming = false

        Log.i(
            AlarmScheduler.TAG,
            "AlarmActivity shown for the dose due $doseInstantIso, seeded with med $medicationId " +
                "[elderly=$elderly, ring=${ringMs / 1000}s per dose, backdrop=$backdrop]",
        )

        bindChrome()
        render()
        startRinging()

        // The seed is one dose; the handful may be four. Ask the store who else
        // is waiting at this instant — always, because the seed is also the ONLY
        // thing known if that read fails.
        refreshFromStore()
    }

    // -- THE HANDFUL ---------------------------------------------------------

    /**
     * Re-read who is still waiting and re-render.
     *
     * `rowsAt` returns UNANSWERED doses only, so this is also the proof that a
     * rung re-presents the right subset: anything already answered simply is not
     * in the result. [DoseFocus.answeredElsewhere] then records the ones this
     * screen knew about that have since dropped out.
     */
    private fun refreshFromStore() {
        val instant = doseInstantIso
        val fallback = seed
        scope.launch {
            val outstanding = DosesAtInstant.rowsAt(applicationContext, instant, fallback)
            if (instant != doseInstantIso) return@launch // a newer dose took over mid-read
            val outstandingIds = outstanding.map { it.medicationId }.toSet()

            // Anything this screen knew about that is no longer outstanding was
            // answered somewhere it could not see. Recorded as an unknown outcome
            // — "✓ Recorded", never a guessed Taken.
            rows.keys.filter { it !in outstandingIds }.forEach { focus.answeredElsewhere(it) }

            rows = (rows + outstanding.associateBy { it.medicationId })
                .filterKeys { it in outstandingIds || it in focus.answered }
            focus.setOrder(rows.keys.sorted())

            if (focus.focused == null && !confirming) {
                if (focus.advance() != null) armRingWindow()
            }

            when {
                focus.isFinished() && focus.outstanding().isEmpty() -> allAnswered()
                confirming -> Unit // the pending advance will render; see [confirming]
                focus.isFinished() -> finishHandful()
                else -> render()
            }
        }
    }

    /**
     * Showing "✓ Taken" and about to move the focus on.
     *
     * A refresh must not re-render over it: recording an answer broadcasts
     * ACTION_ANSWERED — including the answer just made HERE — so without this the
     * confirmation would be replaced within milliseconds, which reads as the tap
     * having done nothing.
     */
    private var confirming = false

    // -- RENDERING -----------------------------------------------------------

    private fun bindChrome() {
        bindBackdrop()

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
        findViewById<TextView>(R.id.alarm_eyebrow).text = AlarmScreenBinder.eyebrowText(this, whenText)
    }

    private fun render() {
        val list = findViewById<LinearLayout>(R.id.alarm_dose_list)
        list.removeAllViews()

        val ordered = rows.keys.sorted().mapNotNull { rows[it] }
        val total = ordered.size
        val focusedId = focus.focused

        val count = findViewById<TextView>(R.id.alarm_group_count)
        when {
            total <= 1 -> count.visibility = View.GONE
            elderly -> {
                count.text = getString(R.string.alarm_group_progress, focus.answered.size + 1, total)
                count.visibility = View.VISIBLE
            }
            else -> {
                count.text = getString(R.string.alarm_group_count, total)
                count.visibility = View.VISIBLE
            }
        }

        val inflater = LayoutInflater.from(this)
        // Elderly is a PURE one-question screen: the list reduces to the focused
        // dose. Every other dose is still outstanding and still laddering — it is
        // only the presentation that narrows.
        val visible = if (elderly) ordered.filter { it.medicationId == focusedId } else ordered

        visible.forEach { row ->
            val view = when {
                row.medicationId == focusedId -> focusedView(inflater, list, row, solo = elderly || total <= 1)
                else -> quietView(inflater, list, row)
            }
            list.addView(view)
        }

        findViewById<Button>(R.id.alarm_snooze).visibility =
            if (focus.outstanding().isEmpty()) View.GONE else View.VISIBLE
    }

    /**
     * The dose being asked about. [solo] picks the full-screen presentation (one
     * dose, or elderly) over the in-list card; both carry the same ids, so this
     * one binding covers them and the two cannot drift.
     */
    private fun focusedView(inflater: LayoutInflater, parent: ViewGroup, row: DoseRow, solo: Boolean): View {
        val view = inflater.inflate(
            if (solo) R.layout.alarm_dose_solo else R.layout.alarm_dose_focused,
            parent,
            false,
        )
        if (solo) view.layoutParams = AlarmScreenBinder.soloLayoutParams()
        AlarmScreenBinder.bindDoseText(view, row.drugName, row.doseLabel, onPhoto)
        if (onPhoto && !solo) view.setBackgroundResource(R.drawable.bg_alarm_card_focused_on_photo)

        view.findViewById<Button>(R.id.dose_taken).setOnClickListener { answer(row, DoseAction.ACTION_TAKEN) }
        view.findViewById<Button>(R.id.dose_skip).setOnClickListener { answer(row, DoseAction.ACTION_SKIP) }
        return view
    }

    /** Waiting, not-answered, or already recorded — see alarm_dose_quiet.xml. */
    private fun quietView(inflater: LayoutInflater, parent: ViewGroup, row: DoseRow): View {
        val view = inflater.inflate(R.layout.alarm_dose_quiet, parent, false)
        val id = row.medicationId
        val isAnswered = focus.answered.containsKey(id)

        val verdict = view.findViewById<TextView>(R.id.dose_verdict)
        when {
            focus.answered[id] == DoseAction.ACTION_TAKEN -> {
                verdict.text = getString(R.string.alarm_recorded_taken)
                verdict.setTextColor(ContextCompat.getColor(this, R.color.verdict_taken))
            }
            focus.answered[id] == DoseAction.ACTION_SKIP -> {
                verdict.text = getString(R.string.alarm_recorded_skipped)
                verdict.setTextColor(ContextCompat.getColor(this, R.color.verdict_taken))
            }
            isAnswered -> {
                verdict.text = getString(R.string.alarm_recorded)
                verdict.setTextColor(ContextCompat.getColor(this, R.color.verdict_taken))
            }
            id in focus.yielded -> {
                verdict.text = getString(R.string.alarm_not_answered)
                verdict.setTextColor(ContextCompat.getColor(this, R.color.verdict_waiting))
            }
            else -> {
                verdict.text = getString(R.string.alarm_waiting)
                verdict.setTextColor(ContextCompat.getColor(this, R.color.alarm_ink_muted))
            }
        }

        AlarmScreenBinder.bindDoseText(view, row.drugName, row.doseLabel, onPhoto)

        if (isAnswered) {
            // Inert. Correcting a dose is a judgement about the past and belongs
            // on the caregiver's history surface, not a 3am alarm screen.
            view.setBackgroundResource(
                if (onPhoto) R.drawable.bg_alarm_card_on_photo else R.drawable.bg_alarm_card_quiet,
            )
        } else {
            view.setBackgroundResource(
                if (onPhoto) R.drawable.bg_alarm_card_on_photo else R.drawable.bg_alarm_card,
            )
            view.contentDescription = "${row.drugName}. ${getString(R.string.alarm_tap_to_answer)}"
            view.setOnClickListener {
                // ANY ORDER. A handful is not a queue, and the medicine you can
                // reach first is a perfectly good one to answer first.
                focus.focusOn(id)
                armRingWindow()
                render()
            }
        }
        return view
    }

    /**
     * The backdrop, drawn by [AlarmScreenBinder] — the same call the Settings
     * miniature makes, which is what stops the two from drifting apart.
     */
    private fun bindBackdrop() {
        onPhoto = AlarmScreenBinder.bindBackdrop(
            findViewById(android.R.id.content),
            backdrop,
            resources.displayMetrics,
        )
        if (!onPhoto) backdrop = AlarmMedia.Image.None
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
     * Taken / Skip for ONE dose. The others in the handful are untouched: their
     * ladders keep running and the alarm keeps ringing until the last one has had
     * its turn.
     */
    private fun answer(row: DoseRow, action: String) {
        val id = row.medicationId
        if (focus.answered.containsKey(id)) return
        enqueue(row, action)

        val next = focus.answer(id, action)
        if (next == null && focus.outstanding().isEmpty()) {
            allAnswered()
            return
        }

        // Confirm on the row before the focus moves. Advancing instantly makes
        // four taps feel like one mis-registered tap.
        confirming = true
        render()
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({
            confirming = false
            if (closing) return@postDelayed
            if (focus.focused == null) finishHandful() else { armRingWindow(); render() }
        }, ADVANCE_MS)
    }

    /**
     * The focused dose's ring window expired.
     *
     * It YIELDS — not resolved, not recorded, no outcome invented. Its ladder
     * keeps running and it will be in the missed notice; it simply stops holding
     * the screen so the next dose can be asked. Before this existed, one
     * unanswered dose meant the rest of the handful was never asked at all.
     */
    private fun onRingWindowExpired() {
        val yielded = focus.focused
        val next = focus.yieldFocus()
        Log.i(
            AlarmScheduler.TAG,
            "med $yielded rang ${ringMs / 1000}s with no answer — yielding to " +
                (next?.let { "med $it" } ?: "nothing; the handful is done"),
        )
        if (next == null) finishHandful() else { armRingWindow(); render() }
    }

    /**
     * Every dose has had its turn. Some may still be unanswered — that is exactly
     * what the missed notice and the server escalation ladder are for.
     */
    private fun finishHandful() {
        if (closing) return
        closing = true
        Log.i(AlarmScheduler.TAG, "every dose due $doseInstantIso has had its turn; closing")
        dismissUnattended()
    }

    /**
     * Every dose in the handful is ANSWERED. Stop ringing immediately, show it,
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
     * ONE BUTTON FOR THE HANDFUL, and only for what is still outstanding —
     * including doses that already yielded. "Not now" means the same thing
     * whether it covers one medicine or four, and a dose already answered is not
     * un-answered by deferring the rest.
     */
    private fun snoozeRemaining() {
        val remaining = focus.outstanding().mapNotNull { rows[it] }
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
     * The screen is over with doses unanswered — every dose had its turn, the
     * window was closed, or the alarm stopped being visible.
     *
     * Crucially this does NOT just cancel the notification and vanish, which is
     * what the old dismiss()-on-timeout did: a patient who slept through a dose
     * woke to no trace of it at all. The ringing alarm notification is replaced
     * with a quiet, persistent "Missed" notice so the reminder survives.
     *
     * **Only the doses still unanswered are affected.** Answering two of four and
     * walking away leaves those two answered and the other two chased.
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

    /** Sound, vibration and the first ring window — re-armable, for the hand-over case. */
    private fun startRinging() {
        released = false
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        startAlarmSound()
        startVibration()
        armRingWindow()
    }

    /**
     * Start (or restart) the focused dose's ring window.
     *
     * postDelayed on the MAIN looper is correct here specifically because this
     * activity keeps the screen on: uptimeMillis (which postDelayed uses) only
     * stalls in deep sleep, and the device cannot be in deep sleep while this
     * window is visible. So the timeout is guaranteed to run — including over the
     * lock screen, which is just a normal visible window as far as the looper is
     * concerned.
     */
    private fun armRingWindow() {
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({ onRingWindowExpired() }, ringMs)
    }

    /**
     * ONE sound for the whole handful, started once.
     *
     * Deliberately not per row: restarting the tone each time the focus moves
     * would stutter the alarm down the list, at exactly the moment someone is
     * trying to read a medicine name.
     */
    private fun startAlarmSound() {
        playAlarm(AlarmMedia.resolveSound(this, seed?.audioPath))
    }

    private fun playAlarm(localVoice: File?) {
        // A care-circle voice recording wins over the default tone when one is
        // on disk. Local file only — never a stream, so this works in airplane
        // mode (CLAUDE.md's non-negotiable for the voice feature).
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
     * by accident while half asleep. The per-dose ring window is the escape
     * hatch, so this can never trap anyone.
     */
    @Deprecated("Activity.onBackPressed is deprecated; intentional no-op for an alarm screen")
    override fun onBackPressed() {
        // no-op
    }
}
