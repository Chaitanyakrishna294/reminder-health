package com.reminderhealth.app.schedule

import android.app.Activity
import android.app.NotificationManager
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
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.reminderhealth.app.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
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
 * scrutiny). Pure native: it reads its content from the intent extras and the
 * local Room store, so it works with no network and without the webview ever
 * starting.
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
 *  - [releaseEverything] is called from every exit path (action tap, timeout,
 *    onDestroy) and is idempotent; it stops the looping audio and vibration,
 *    which ARE things that would otherwise outlive the screen;
 *  - `FLAG_KEEP_SCREEN_ON` is dropped by the OS when the window goes away;
 *  - no service, no repeating alarm, nothing survives this screen.
 */
class AlarmActivity : Activity() {

    companion object {
        /** Mirrors src/constants.js SNOOZE_MINUTES so device and bot agree. */
        const val SNOOZE_MINUTES = 10

        /**
         * Auto-dismiss after this long. Matches CLAUDE.md's ~60s figure. An
         * unanswered alarm is NOT resolved here — the server pipeline still
         * owns missed-dose escalation, exactly as it does for web-only users.
         */
        private const val AUTO_DISMISS_MS = 60_000L
    }

    private var player: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private val autoDismiss = Handler(Looper.getMainLooper())
    private var released = false

    private var medicationId = -1L
    private var drugName = "your medication"
    private var doseLabel: String? = null
    private var scheduledFor: String? = null

    /**
     * Family voice alarms (CLAUDE.md "Post-M2 features"). Null until that
     * feature ships; both are LOCAL paths, verified readable before use, so a
     * missing or deleted file falls back instead of breaking the alarm.
     */
    private var audioFile: File? = null
    private var photoFile: File? = null

    /**
     * The same dose was just answered from the notification's Taken/Skip buttons
     * (see [DoseActionReceiver]), so this screen must stop ringing rather than
     * keep alarming at someone who already responded.
     *
     * Treated as answered, NOT unattended: [releaseEverything] runs before
     * [finish], so `released` is set and [onStop] will not post a missed-dose
     * fallback for a dose that was in fact answered.
     */
    private val answeredElsewhere = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val answeredId = intent?.getLongExtra(AlarmScheduler.EXTRA_MEDICATION_ID, -1L) ?: -1L
            if (answeredId != medicationId) return
            Log.i(
                AlarmScheduler.TAG,
                "med $medicationId answered from the notification; closing the alarm screen",
            )
            releaseEverything()
            finish()
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

        medicationId = intent.getLongExtra(AlarmScheduler.EXTRA_MEDICATION_ID, -1L)
        drugName = intent.getStringExtra(AlarmScheduler.EXTRA_DRUG_NAME) ?: drugName
        doseLabel = intent.getStringExtra(AlarmScheduler.EXTRA_DOSE_LABEL)
        scheduledFor = intent.getStringExtra(AlarmScheduler.EXTRA_SCHEDULED_FOR)
        audioFile = readableFileOrNull(intent.getStringExtra(AlarmScheduler.EXTRA_AUDIO_PATH), "audio")
        photoFile = readableFileOrNull(intent.getStringExtra(AlarmScheduler.EXTRA_PHOTO_PATH), "photo")

        Log.i(
            AlarmScheduler.TAG,
            "AlarmActivity shown for med $medicationId ($drugName) " +
                "[voice=${audioFile != null}, photo=${photoFile != null}]",
        )

        bindContent()
        startAlarmSound()
        startVibration()

        // Unattended-alarm safety net. postDelayed on the MAIN looper is correct
        // here specifically because this activity keeps the screen on: uptimeMillis
        // (which postDelayed uses) only stalls in deep sleep, and the device cannot
        // be in deep sleep while this window is visible. So the timeout is
        // guaranteed to run — including over the lock screen, which is just a
        // normal visible window as far as the looper is concerned.
        autoDismiss.postDelayed({
            Log.i(AlarmScheduler.TAG, "alarm auto-dismissed after ${AUTO_DISMISS_MS}ms with NO action")
            dismissUnattended()
        }, AUTO_DISMISS_MS)

        findViewById<Button>(R.id.alarm_taken).setOnClickListener { resolve("TAKEN") }
        findViewById<Button>(R.id.alarm_skip).setOnClickListener { resolve("SKIP") }
        findViewById<Button>(R.id.alarm_snooze).setOnClickListener { snooze() }
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

    private fun bindContent() {
        findViewById<TextView>(R.id.alarm_drug_name).text = drugName
        findViewById<TextView>(R.id.alarm_dose).text = doseLabel ?: ""
        bindPhoto()

        // Eyebrow shows the dose's own scheduled LOCAL time, not "now" — if the
        // phone was asleep and the alarm is a moment late, the honest answer is
        // when the dose was due.
        val eyebrow = findViewById<TextView>(R.id.alarm_eyebrow)
        val whenText = scheduledFor?.let { iso ->
            runCatching {
                DateTimeFormatter.ofPattern("h:mm a")
                    .withZone(ZoneId.systemDefault())
                    .format(Instant.parse(iso))
            }.getOrNull()
        }
        eyebrow.text = if (whenText != null) {
            "${getString(R.string.alarm_eyebrow_prefix)} · $whenText"
        } else {
            getString(R.string.alarm_eyebrow_prefix)
        }
    }

    /**
     * Shows the care-circle photo full-screen when one is present, and flips the
     * text to white over the scrim so it stays readable against an arbitrary
     * photo. With no photo, nothing changes — the default alarm keeps its own
     * light palette.
     */
    private fun bindPhoto() {
        val file = photoFile ?: return
        val bitmap = runCatching { BitmapFactory.decodeFile(file.absolutePath) }.getOrNull()
        if (bitmap == null) {
            Log.w(AlarmScheduler.TAG, "photo at ${file.absolutePath} could not be decoded — using default")
            return
        }

        findViewById<ImageView>(R.id.alarm_photo).apply {
            setImageBitmap(bitmap)
            visibility = View.VISIBLE
        }
        findViewById<View>(R.id.alarm_photo_scrim).visibility = View.VISIBLE

        val onPhoto = Color.WHITE
        findViewById<TextView>(R.id.alarm_eyebrow).setTextColor(onPhoto)
        findViewById<TextView>(R.id.alarm_drug_name).setTextColor(onPhoto)
        findViewById<TextView>(R.id.alarm_dose).setTextColor(onPhoto)
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

    private fun startAlarmSound() {
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

    /**
     * Taken / Skip. Queued locally FIRST, then synced — see [enqueue].
     */
    private fun resolve(action: String) {
        enqueue(action)
        dismiss()
    }

    /**
     * Snooze does two independent things, and both must happen:
     *  - reschedules THIS device's alarm, so the patient is asked again;
     *  - queues a server-side snooze, so `reminder_events.retry_reminder_at`
     *    moves and the care circle is NOT told the dose was missed. A
     *    device-only snooze would produce a false escalation alert — which is
     *    why `snooze_reminder_event` exists at all.
     */
    private fun snooze() {
        if (medicationId > 0L) {
            AlarmScheduler.scheduleAt(
                context = this,
                medicationId = medicationId,
                drugName = drugName,
                doseLabel = doseLabel,
                fireAt = Instant.now().plusSeconds(SNOOZE_MINUTES * 60L),
                audioPath = audioFile?.absolutePath,
                photoPath = photoFile?.absolutePath,
            )
            Log.i(AlarmScheduler.TAG, "snoozed med $medicationId by $SNOOZE_MINUTES min")
            enqueue(DoseAction.ACTION_SNOOZE)
        }
        dismiss()
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
     * alarm screen must close instantly, and the queue plus WorkManager already
     * guarantee delivery without this Activity being alive.
     */
    private fun enqueue(action: String) {
        val appContext = applicationContext
        val medicationId = this.medicationId
        val drugName = this.drugName
        val scheduled = scheduledFor
        val snoozeMinutes = if (action == DoseAction.ACTION_SNOOZE) SNOOZE_MINUTES else null

        CoroutineScope(Dispatchers.IO).launch {
            // Shared with DoseActionReceiver (the notification's Taken/Skip
            // buttons) so both answer paths record identically.
            DoseActionQueue.record(
                context = appContext,
                medicationId = medicationId,
                drugName = drugName,
                scheduledFor = scheduled,
                action = action,
                snoozeMinutes = snoozeMinutes,
            )
        }
    }

    /**
     * The user answered. Clears the alarm notification, since the dose is
     * resolved and there is nothing left to chase.
     */
    private fun dismiss() {
        releaseEverything()
        (getSystemService(NOTIFICATION_SERVICE) as? NotificationManager)
            ?.cancel(medicationId.toInt())
        finish()
    }

    /**
     * Nobody answered — auto-timeout, or the alarm stopped being visible.
     *
     * Crucially this does NOT just cancel the notification and vanish, which is
     * what the old dismiss()-on-timeout did: a patient who slept through a dose
     * woke to no trace of it at all. The ringing alarm notification is replaced
     * with a quiet, persistent "Missed: take X" so the reminder survives.
     *
     * The dose is deliberately left UNRESOLVED — the server pipeline still owns
     * missed-dose escalation, exactly as it does for web-only users. Recording a
     * silent outcome here would hide a missed dose from the care circle.
     */
    private fun dismissUnattended() {
        releaseEverything()

        val manager = getSystemService(NOTIFICATION_SERVICE) as? NotificationManager
        manager?.cancel(medicationId.toInt())

        if (medicationId > 0L) {
            DoseNotifications.showMissedDose(
                context = this,
                medicationId = medicationId,
                drugName = drugName,
                doseLabel = doseLabel,
                scheduledForIso = scheduledFor,
                audioPath = audioFile?.absolutePath,
                photoPath = photoFile?.absolutePath,
            )
        }
        finish()
    }

    /** Idempotent — safe from any exit path, and called from all of them. */
    private fun releaseEverything() {
        if (released) return
        released = true

        autoDismiss.removeCallbacksAndMessages(null)

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
     * unattended so the missed-dose fallback is posted rather than the reminder
     * silently disappearing.
     *
     * releaseEverything() is idempotent, so the onStop that happens during a
     * normal finish() is a harmless no-op.
     */
    override fun onStop() {
        if (!released) {
            Log.i(AlarmScheduler.TAG, "alarm no longer visible (onStop) — treating as unattended")
            dismissUnattended()
        }
        super.onStop()
    }

    override fun onDestroy() {
        releaseEverything()
        runCatching { unregisterReceiver(answeredElsewhere) }
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
