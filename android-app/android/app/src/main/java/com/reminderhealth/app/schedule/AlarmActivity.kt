package com.reminderhealth.app.schedule

import android.app.Activity
import android.app.NotificationManager
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView
import com.reminderhealth.app.R
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
 * Lifecycle discipline (CLAUDE.md hard rule — "wake locks released the moment
 * the alarm is dismissed or after ~60s auto-timeout"):
 *  - the wake lock is acquired WITH a 60s OS-level timeout, so even a crash
 *    between here and [releaseEverything] cannot leak it;
 *  - [releaseEverything] is called from every exit path (action tap, timeout,
 *    onDestroy) and is idempotent;
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

    private var wakeLock: PowerManager.WakeLock? = null
    private var player: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private val autoDismiss = Handler(Looper.getMainLooper())
    private var released = false

    private var medicationId = -1L
    private var drugName = "your medication"
    private var doseLabel: String? = null
    private var scheduledFor: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        showOverLockScreen()
        setContentView(R.layout.activity_alarm)

        medicationId = intent.getLongExtra(AlarmScheduler.EXTRA_MEDICATION_ID, -1L)
        drugName = intent.getStringExtra(AlarmScheduler.EXTRA_DRUG_NAME) ?: drugName
        doseLabel = intent.getStringExtra(AlarmScheduler.EXTRA_DOSE_LABEL)
        scheduledFor = intent.getStringExtra(AlarmScheduler.EXTRA_SCHEDULED_FOR)

        Log.i(AlarmScheduler.TAG, "AlarmActivity shown for med $medicationId ($drugName)")

        bindContent()
        acquireWakeLock()
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

    private fun bindContent() {
        findViewById<TextView>(R.id.alarm_drug_name).text = drugName
        findViewById<TextView>(R.id.alarm_dose).text = doseLabel ?: ""

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

    private fun acquireWakeLock() {
        val manager = getSystemService(POWER_SERVICE) as? PowerManager ?: return
        // PARTIAL is the right kind: the window flags above own the SCREEN, this
        // just guarantees the CPU stays up long enough to ring. The timeout is a
        // hard backstop so the lock cannot outlive the alarm even if something
        // throws before releaseEverything() runs.
        wakeLock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "reminderhealth:alarm").apply {
            setReferenceCounted(false)
            acquire(AUTO_DISMISS_MS)
        }
    }

    private fun startAlarmSound() {
        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            ?: return
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

        wakeLock?.let { if (it.isHeld) runCatching { it.release() } }
        wakeLock = null

        Log.i(AlarmScheduler.TAG, "alarm resources released (wake lock, sound, vibration)")
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
