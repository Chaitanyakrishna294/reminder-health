package com.reminderhealth.app.schedule

import android.app.Activity
import android.app.NotificationManager
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
import com.reminderhealth.app.R
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        showOverLockScreen()
        setContentView(R.layout.activity_alarm)

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

        autoDismiss.postDelayed({
            Log.i(AlarmScheduler.TAG, "alarm auto-dismissed after ${AUTO_DISMISS_MS}ms with no action")
            dismiss()
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
     * Taken / Skip. STEP 4 SCOPE: stops the alarm and dismisses. Recording the
     * action locally and syncing it to `resolve_reminder_event` is step 6 (the
     * offline action queue) — until that lands, the server still learns the
     * outcome only through its own pipeline, so nothing is silently lost from
     * the patient's record, but the tap itself is not yet persisted.
     */
    private fun resolve(action: String) {
        Log.i(
            AlarmScheduler.TAG,
            "alarm action $action for med $medicationId ($drugName) scheduled $scheduledFor " +
                "— NOT yet queued for sync (step 6)",
        )
        dismiss()
    }

    private fun snooze() {
        if (medicationId > 0L) {
            AlarmScheduler.scheduleAt(
                context = this,
                medicationId = medicationId,
                drugName = drugName,
                doseLabel = doseLabel,
                fireAt = Instant.now().plusSeconds(SNOOZE_MINUTES * 60L),
            )
            Log.i(AlarmScheduler.TAG, "snoozed med $medicationId by $SNOOZE_MINUTES min")
        }
        dismiss()
    }

    private fun dismiss() {
        releaseEverything()
        (getSystemService(NOTIFICATION_SERVICE) as? NotificationManager)
            ?.cancel(medicationId.toInt())
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

        Log.i(AlarmScheduler.TAG, "alarm resources released (sound, vibration)")
    }

    override fun onDestroy() {
        releaseEverything()
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
