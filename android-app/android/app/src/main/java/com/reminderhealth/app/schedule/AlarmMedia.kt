package com.reminderhealth.app.schedule

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Log
import com.reminderhealth.app.R
import java.io.File

/**
 * THE PICTURE AND THE SOUND THE ALARM USES — device-local, always.
 *
 * The alarm has to show its image and play its sound with the phone in airplane
 * mode, at 3am, with the app process dead. So the bytes live in app-private
 * storage (`filesDir/alarm-media/`) and nothing here ever touches a URL. That is
 * the same rule the family-voice feature was always going to need
 * (CLAUDE.md "Post-M2 features": *never* stream at fire time); this phase just
 * gets there without Supabase in the loop at all.
 *
 * **The copy is the point.** A gallery pick hands back a `content://` URI that
 * belongs to another app and can be revoked, moved, or deleted. Copying the bytes
 * in means the alarm keeps working after the user tidies their photos — which
 * they will, and which must not silently turn their alarm back into a grey
 * screen.
 *
 * ## Global, not per medication (decided 2026-08-14)
 *
 * One image and one sound for every alarm. The data model supports this with no
 * schema change anywhere: two keys in [AlarmPrefs] and two files on disk.
 *
 * A per-medication override is the natural next step and is **already half
 * built** — `Medication.alarmAudioPath` / `alarmPhotoPath` exist in Room (v2),
 * `AlarmActivity` already reads them, and [resolveSound] already prefers them.
 * What it needs is a place to *set* them, which means per-medication UI and a
 * server column, i.e. a migration and a sync path. Doing global first costs
 * nothing later: the resolution order below is the override's mechanism,
 * finished and testable today with only one of its two inputs populated.
 */
object AlarmMedia {

    private const val DIR = "alarm-media"
    private const val IMAGE_FILE = "alarm-image"
    private const val SOUND_FILE = "alarm-sound"

    /**
     * Size ceilings on the COPY, not on the picker.
     *
     * A picker filter is advice — the same argument as the Health Vault rule in
     * CLAUDE.md, and here the cost of ignoring it lands on the alarm: a 90 MB
     * recording in app-private storage is the user's disk, and a huge bitmap is
     * an OOM on the one screen that must never crash.
     */
    private const val MAX_IMAGE_BYTES = 12L * 1024 * 1024
    private const val MAX_SOUND_BYTES = 10L * 1024 * 1024

    /** Choices the settings picker can set. Stored as strings, so an unknown value degrades. */
    const val IMAGE_NONE = "none"
    const val IMAGE_CUSTOM = "custom"
    const val SOUND_DEFAULT = "default"
    const val SOUND_CUSTOM = "custom"

    /**
     * The three images shipped inside the APK.
     *
     * Authored gradients rather than photographs, deliberately: they are legible
     * BY CONSTRUCTION at any size, weigh nothing in the APK, and cannot arrive
     * with a bright corner that eats a button. A user who wants a real
     * photograph has the gallery picker, which is the honest way to get one.
     */
    val BUNDLED = linkedMapOf(
        "dawn" to R.drawable.alarm_bg_dawn,
        "calm" to R.drawable.alarm_bg_calm,
        "night" to R.drawable.alarm_bg_night,
    )

    sealed class Image {
        /** Today's alarm, unchanged — no backdrop at all. */
        object None : Image()
        data class Bundled(val key: String, val resId: Int) : Image()
        data class Local(val file: File) : Image()
    }

    private fun dir(context: Context): File =
        File(context.applicationContext.filesDir, DIR).apply { if (!exists()) mkdirs() }

    fun imageFile(context: Context): File = File(dir(context), IMAGE_FILE)
    fun soundFile(context: Context): File = File(dir(context), SOUND_FILE)

    // -- RESOLUTION ----------------------------------------------------------

    /**
     * Which image this alarm shows.
     *
     * [medicationPhotoPath] is the per-medication override slot. It is null in
     * this phase and checked anyway — the branch is the override's whole
     * mechanism, and leaving it out would mean rewriting resolution later
     * instead of populating a column.
     */
    fun resolveImage(context: Context, medicationPhotoPath: String? = null): Image {
        readable(medicationPhotoPath)?.let { return Image.Local(it) }

        return when (val choice = AlarmPrefs.imageChoice(context)) {
            IMAGE_CUSTOM -> {
                val file = imageFile(context)
                if (file.isFile && file.canRead() && file.length() > 0L) {
                    Image.Local(file)
                } else {
                    // The copy is gone (cleared data, a failed import). Fall back
                    // rather than showing a broken frame on the alarm.
                    Log.w(AlarmScheduler.TAG, "alarm image is set to custom but the local copy is missing")
                    Image.None
                }
            }
            IMAGE_NONE -> Image.None
            else -> BUNDLED[choice]?.let { Image.Bundled(choice, it) } ?: Image.None
        }
    }

    /** The alarm's sound file, or null to use the system alarm tone. */
    fun resolveSound(context: Context, medicationAudioPath: String? = null): File? {
        readable(medicationAudioPath)?.let { return it }
        if (AlarmPrefs.soundChoice(context) != SOUND_CUSTOM) return null
        val file = soundFile(context)
        if (file.isFile && file.canRead() && file.length() > 0L) return file
        Log.w(AlarmScheduler.TAG, "alarm sound is set to custom but the local copy is missing — using the default tone")
        return null
    }

    private fun readable(path: String?): File? {
        if (path.isNullOrBlank()) return null
        val file = File(path)
        return if (file.isFile && file.canRead() && file.length() > 0L) file else null
    }

    // -- IMPORT --------------------------------------------------------------

    /**
     * Copy a picked file into app-private storage and select it.
     *
     * Staged then renamed: a process death partway through a copy must not leave
     * a truncated file selected, because the next alarm would try to decode it.
     * Same discipline as the SQLCipher conversion in [ScheduleDatabaseCrypto].
     *
     * @return the stored file, or null with the previous selection untouched.
     */
    fun importImage(context: Context, uri: Uri): File? =
        copyIn(context, uri, imageFile(context), MAX_IMAGE_BYTES, "image")?.also {
            AlarmPrefs.setImageChoice(context, IMAGE_CUSTOM)
        }

    fun importSound(context: Context, uri: Uri): File? =
        copyIn(context, uri, soundFile(context), MAX_SOUND_BYTES, "sound")?.also {
            AlarmPrefs.setSoundChoice(context, SOUND_CUSTOM)
        }

    private fun copyIn(context: Context, uri: Uri, target: File, maxBytes: Long, kind: String): File? {
        val staged = File(target.parentFile, "${target.name}.staged")
        return try {
            var written = 0L
            context.contentResolver.openInputStream(uri)?.use { input ->
                staged.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) break
                        written += read
                        if (written > maxBytes) {
                            Log.w(AlarmScheduler.TAG, "alarm $kind is over ${maxBytes / 1024 / 1024}MB; refusing it")
                            return null
                        }
                        output.write(buffer, 0, read)
                    }
                }
            } ?: run {
                Log.e(AlarmScheduler.TAG, "could not open the picked alarm $kind")
                return null
            }

            if (written == 0L) return null
            if (target.exists()) target.delete()
            if (!staged.renameTo(target)) {
                Log.e(AlarmScheduler.TAG, "could not move the picked alarm $kind into place")
                return null
            }
            Log.i(AlarmScheduler.TAG, "alarm $kind copied into app storage ($written bytes) — the original can be deleted")
            target
        } catch (e: Exception) {
            Log.e(AlarmScheduler.TAG, "failed to import the alarm $kind", e)
            null
        } finally {
            if (staged.exists()) staged.delete()
        }
    }

    fun clearImage(context: Context) {
        runCatching { imageFile(context).delete() }
        AlarmPrefs.setImageChoice(context, IMAGE_NONE)
    }

    fun clearSound(context: Context) {
        runCatching { soundFile(context).delete() }
        AlarmPrefs.setSoundChoice(context, SOUND_DEFAULT)
    }

    // -- DECODING ------------------------------------------------------------

    /**
     * Decode a local image DOWNSAMPLED to roughly the screen.
     *
     * `BitmapFactory.decodeFile` on a modern 50-megapixel phone photo allocates
     * about 200 MB, which on the low-end Android this app targets is an
     * OutOfMemoryError — on the one screen in the product that must never crash.
     * The gallery picker makes exactly that file one tap away, so this is a
     * likely path, not a theoretical one.
     */
    fun decodeSampled(file: File, reqWidth: Int, reqHeight: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        runCatching { BitmapFactory.decodeFile(file.absolutePath, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        var sample = 1
        while (
            bounds.outHeight / (sample * 2) >= reqHeight.coerceAtLeast(1) &&
            bounds.outWidth / (sample * 2) >= reqWidth.coerceAtLeast(1)
        ) {
            sample *= 2
        }

        return runCatching {
            BitmapFactory.decodeFile(
                file.absolutePath,
                BitmapFactory.Options().apply { inSampleSize = sample },
            )
        }.onFailure {
            Log.e(AlarmScheduler.TAG, "could not decode the alarm image at ${file.absolutePath}", it)
        }.getOrNull()
    }
}
