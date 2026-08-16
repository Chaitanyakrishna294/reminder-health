package com.reminderhealth.app.schedule

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.util.Base64
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ContextThemeWrapper
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.reminderhealth.app.R
import java.io.ByteArrayOutputStream

/**
 * A PICTURE OF THE REAL ALARM SCREEN, for the Settings miniature.
 *
 * ## Why this is a bitmap of the real layout, not a web mock-up
 *
 * Settings runs in the webview; the alarm is a native Activity. A CSS
 * recreation would be a second implementation of the most safety-critical screen
 * in the product, and the moment the two diverge the preview becomes a lie about
 * what someone will see at 3am — with no way for them to check until then. So
 * the preview inflates **the same XML**, binds it through **the same
 * [AlarmScreenBinder]**, resolves the backdrop through **the same [AlarmMedia]**,
 * and draws the result to a bitmap. If the alarm screen changes, this changes
 * with it, by construction rather than by anyone remembering.
 *
 * It is deliberately NOT interactive and has no handlers attached: it is a
 * picture of the screen, not the screen. Nothing here rings, times, or records.
 *
 * ## Rendered at real size, then scaled
 *
 * Measured and laid out at the device's actual screen dimensions before being
 * scaled down. Laying out at preview size instead would re-wrap the text and
 * re-balance the weighted identity block, so a long medicine name could look
 * fine in the miniature and overflow on the real alarm — exactly the class of
 * drift this whole approach exists to rule out.
 */
object AlarmPreview {

    /**
     * Sample content. Deliberately generic rather than one of the user's own
     * medications: this is a picture of a screen, and putting a real drug name in
     * it invites the reading that the preview is a live dose.
     */
    private const val SAMPLE_NAME = "Sample medicine"
    private const val SAMPLE_DOSE = "1 tablet"
    private const val SAMPLE_TIME = "8:00 AM"

    /** Displayed small; JPEG at this width keeps the payload well under 100 KB. */
    private const val DEFAULT_WIDTH_PX = 420
    private const val JPEG_QUALITY = 86

    /**
     * Render the alarm screen as a base64 `data:` URI the webview can show in an
     * `<img>`.
     *
     * @return null when anything goes wrong. The caller must treat that as "no
     *   preview" rather than as an error — a settings screen must not break
     *   because a picture could not be drawn.
     */
    fun renderDataUri(context: Context, targetWidthPx: Int = DEFAULT_WIDTH_PX): String? {
        val bitmap = render(context, targetWidthPx) ?: return null
        return try {
            val bytes = ByteArrayOutputStream().use { out ->
                bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
                out.toByteArray()
            }
            "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
        } catch (e: Exception) {
            Log.e(AlarmScheduler.TAG, "could not encode the alarm preview", e)
            null
        } finally {
            bitmap.recycle()
        }
    }

    private fun render(context: Context, targetWidthPx: Int): Bitmap? = try {
        val metrics = context.resources.displayMetrics
        val width = metrics.widthPixels.coerceAtLeast(320)
        val height = metrics.heightPixels.coerceAtLeast(480)

        // The Activity's own theme, so type and colours resolve exactly as they
        // do there. AlarmTheme is pinned to Theme.Material.Light on purpose — a
        // dose alarm looks identical at 3am and 3pm (CLAUDE.md's theme rule), and
        // that has to be true of its preview too.
        //
        // AND ITS LANGUAGE. AlarmActivity localizes via attachBaseContext; this
        // preview inflates the same XML by hand, so it has to do the same thing
        // explicitly or the miniature would show English while the real alarm
        // shows Telugu. A preview that stops matching is worse than no preview —
        // it is a promise about a screen the user next sees at 3am.
        val themed = ContextThemeWrapper(AlarmPrefs.localized(context), R.style.AlarmTheme)
        val root = LayoutInflater.from(themed).inflate(R.layout.activity_alarm, null, false)

        val backdrop = AlarmMedia.resolveImage(context)
        val onPhoto = AlarmScreenBinder.bindBackdrop(root, backdrop, metrics)

        root.findViewById<TextView>(R.id.alarm_eyebrow).text =
            AlarmScreenBinder.eyebrowText(themed, SAMPLE_TIME)
        // One sample dose, so the miniature shows the solo presentation — the
        // shape the overwhelming majority of real alarms take.
        root.findViewById<TextView>(R.id.alarm_group_count).visibility = View.GONE

        val list = root.findViewById<LinearLayout>(R.id.alarm_dose_list)
        val dose = LayoutInflater.from(themed).inflate(R.layout.alarm_dose_solo, list, false)
        dose.layoutParams = AlarmScreenBinder.soloLayoutParams()
        AlarmScreenBinder.bindDoseText(dose, SAMPLE_NAME, SAMPLE_DOSE, onPhoto)
        // No click listeners, deliberately — see the class comment.
        list.addView(dose)
        root.findViewById<Button>(R.id.alarm_snooze).visibility = View.VISIBLE

        root.measure(
            View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
        )
        root.layout(0, 0, width, height)

        val full = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        root.draw(Canvas(full))

        val scale = targetWidthPx.toFloat() / width
        val scaled = Bitmap.createScaledBitmap(
            full,
            targetWidthPx,
            (height * scale).toInt().coerceAtLeast(1),
            true,
        )
        if (scaled != full) full.recycle()
        scaled
    } catch (e: Throwable) {
        // Throwable, not Exception: an OutOfMemoryError while drawing a
        // full-screen bitmap is the realistic failure here, and a settings
        // screen losing its preview is far better than the app dying on it.
        Log.e(AlarmScheduler.TAG, "could not render the alarm preview", e)
        null
    }
}
