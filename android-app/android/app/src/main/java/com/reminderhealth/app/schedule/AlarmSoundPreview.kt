package com.reminderhealth.app.schedule

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Play the chosen alarm sound once, so it can be heard before 3am.
 *
 * A sound cannot be shown, so this is its half of the Settings preview. It uses
 * the SAME resolution the alarm does ([AlarmMedia.resolveSound]) and the same
 * `USAGE_ALARM` routing, because the useful question is "what will actually wake
 * me", and a preview played quietly through the media stream would answer a
 * different one.
 *
 * Three deliberate differences from the real alarm:
 *  - **not looping**, and hard-stopped after [MAX_MS] — a preview that had to be
 *    switched off manually would be a small trap in a settings screen;
 *  - **no vibration**, no screen-on, nothing else the alarm does;
 *  - **one at a time** — tapping play twice replaces rather than layers.
 */
object AlarmSoundPreview {

    /** Long enough to recognise a tone, short enough that forgetting to stop costs nothing. */
    private const val MAX_MS = 10_000L

    private var player: MediaPlayer? = null
    private val handler = Handler(Looper.getMainLooper())

    @Synchronized
    fun play(context: Context): Boolean {
        stop()
        val local = AlarmMedia.resolveSound(context)
        val uri: Uri = if (local != null) {
            Uri.fromFile(local)
        } else {
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
                ?: return false
        }

        player = runCatching {
            MediaPlayer().apply {
                setDataSource(context, uri)
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                isLooping = false
                setOnCompletionListener { stop() }
                prepare()
                start()
            }
        }.onFailure {
            Log.e(AlarmScheduler.TAG, "could not play the alarm sound preview", it)
        }.getOrNull() ?: return false

        handler.postDelayed({ stop() }, MAX_MS)
        return true
    }

    @Synchronized
    fun stop() {
        handler.removeCallbacksAndMessages(null)
        runCatching { player?.stop() }
        runCatching { player?.release() }
        player = null
    }

    @Synchronized
    fun isPlaying(): Boolean = runCatching { player?.isPlaying == true }.getOrDefault(false)
}
