package com.reminderhealth.app.schedule

import android.content.Context
import android.graphics.Color
import android.util.DisplayMetrics
import android.util.Log
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.reminderhealth.app.R

/**
 * HOW THE ALARM SCREEN IS COMPOSED — the one copy of it.
 *
 * [AlarmActivity] is the real alarm; [AlarmPreview] is the miniature shown in
 * Settings. Both inflate the same layouts and both call these functions, so the
 * preview cannot drift from the thing it claims to preview.
 *
 * That is the whole reason this file exists rather than the preview drawing its
 * own lookalike. A settings preview that quietly stops matching the alarm is
 * worse than having no preview at all: it is a promise about a screen the user
 * will next see at 3am, and they have no way to check it until then.
 *
 * What is NOT here: click handlers, focus rotation, ringing, timers. Those are
 * the Activity's, and the preview deliberately has none of them — it is a
 * picture of the screen, not the screen.
 */
object AlarmScreenBinder {

    /**
     * Draw the chosen backdrop behind everything, under a fixed scrim.
     *
     * THE SCRIM IS NOT DECORATION. A user-chosen photograph is arbitrary — it can
     * be bright, busy, or light-on-light — so text over it needs a guaranteed
     * floor rather than the hope that the picture cooperates. Every backdrop,
     * bundled or picked, gets the same 55% black, which is what lets white text
     * clear 4.5:1 without anyone checking each image.
     *
     * The BUTTONS are a separate guarantee: they keep their own opaque fills, so
     * no photograph can affect their contrast at all.
     *
     * @return true when a backdrop actually rendered, so content can switch to
     *   its over-photo treatment. False on a decode failure, which is why the
     *   caller must use the RETURN VALUE rather than re-checking the choice.
     */
    fun bindBackdrop(root: View, backdrop: AlarmMedia.Image, metrics: DisplayMetrics): Boolean {
        val photo = root.findViewById<ImageView>(R.id.alarm_photo)
        val scrim = root.findViewById<View>(R.id.alarm_photo_scrim)

        val rendered = when (backdrop) {
            is AlarmMedia.Image.None -> false
            is AlarmMedia.Image.Bundled -> {
                photo.setImageResource(backdrop.resId)
                true
            }
            is AlarmMedia.Image.Local -> {
                // Downsampled: a 50-megapixel gallery photo decoded whole is an
                // OutOfMemoryError on a cheap phone, on the one screen that must
                // never crash. The picker puts exactly that file one tap away.
                val bitmap = AlarmMedia.decodeSampled(backdrop.file, metrics.widthPixels, metrics.heightPixels)
                if (bitmap == null) {
                    Log.w(AlarmScheduler.TAG, "alarm backdrop could not be decoded — falling back to none")
                    false
                } else {
                    photo.setImageBitmap(bitmap)
                    true
                }
            }
        }

        photo.visibility = if (rendered) View.VISIBLE else View.GONE
        scrim.visibility = if (rendered) View.VISIBLE else View.GONE

        if (rendered) {
            val ink = Color.WHITE
            root.findViewById<TextView>(R.id.alarm_eyebrow).setTextColor(ink)
            root.findViewById<TextView>(R.id.alarm_group_count).setTextColor(ink)
        }
        return rendered
    }

    /**
     * The name and dose on a row, plus its over-photo treatment.
     *
     * Shared by the focused card, the solo full-screen dose and the preview —
     * all three use the same ids, which is what lets one function cover them.
     */
    fun bindDoseText(row: View, drugName: String, doseLabel: String?, onPhoto: Boolean) {
        val name = row.findViewById<TextView>(R.id.dose_name)
        val amount = row.findViewById<TextView>(R.id.dose_amount)
        name.text = drugName
        amount.text = doseLabel ?: ""
        amount.visibility = if (doseLabel.isNullOrBlank()) View.GONE else View.VISIBLE
        if (onPhoto) {
            name.setTextColor(Color.WHITE)
            amount.setTextColor(Color.WHITE)
        }
    }

    /**
     * Inflate the FULL-SCREEN single-dose presentation into the list container.
     *
     * The solo dose owns the whole scroll area, which is what lets its identity
     * block absorb the slack and its action band stay pinned low — the geometry
     * verified on device 2026-08-11. The ScrollView's `fillViewport` is the other
     * half: it stretches the list to the viewport, so MATCH_PARENT here resolves
     * to a full screen rather than to the height of the text.
     */
    fun soloLayoutParams(): LinearLayout.LayoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.MATCH_PARENT,
    )

    /** The eyebrow line: "Dose due · 8:00 AM", or just the prefix when the time is unknown. */
    fun eyebrowText(context: Context, localTime: String?): String =
        if (localTime != null) {
            "${context.getString(R.string.alarm_eyebrow_prefix)} · $localTime"
        } else {
            context.getString(R.string.alarm_eyebrow_prefix)
        }
}
