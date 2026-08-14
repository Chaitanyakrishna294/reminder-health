/**
 * Shrink a photo before it is uploaded to the Health Vault.
 *
 * WHY THIS EXISTS. A phone camera produces 8-12 MP files of 4-8 MB. The vault's
 * ceiling is 5 MB, so without this the limit would be fighting the single most
 * ordinary thing a user does: photograph a prescription. Nothing about a
 * prescription needs 12 megapixels — it needs to be readable.
 *
 * It also buys headroom that matters at this project's scale: five photos at
 * 4 MB is 20 MB per user; five at 600 KB is 3 MB. On a deliberately free-tier
 * budget that is the difference between hundreds of users and thousands.
 *
 * IT NEVER MAKES THINGS WORSE. Every failure path returns the ORIGINAL file:
 * a non-image, a format the browser cannot decode (HEIC on most Android
 * Chromes), a canvas that comes back blank, or a "compressed" result that turns
 * out larger than what we started with. The caller's own size check then runs on
 * whatever it gets back, so a file that could not be shrunk is refused with a
 * clear message rather than uploaded and rejected by the server.
 */

import { VAULT_MAX_BYTES } from './limits';

/**
 * Long edge, in pixels. 2000px keeps the small print on a pharmacy label legible
 * when zoomed — the thing a photographed prescription is actually for — while
 * cutting a 12 MP photo to roughly a sixth of its pixels.
 */
const MAX_EDGE = 2000;

/**
 * Below this we leave a photo alone. Re-encoding a file that is already small
 * costs quality and saves almost nothing, and JPEG loss compounds every time.
 */
const COMPRESS_ABOVE_BYTES = 1.5 * 1024 * 1024;

/** Tried in order until the result fits. Below ~0.55 text starts to smear. */
const QUALITY_STEPS = [0.82, 0.7, 0.6];

const isImage = (file: File) =>
  file.type.startsWith('image/') ||
  /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);

/**
 * @returns a smaller JPEG, or the original file untouched. Never throws — a
 *   failure here must not stop someone filing a document.
 */
export async function compressImage(file: File): Promise<File> {
  if (typeof window === 'undefined') return file;
  if (!isImage(file)) return file;

  // A PDF is never touched, and neither is a photo that is already modest.
  const needsResize = file.size > COMPRESS_ABOVE_BYTES;
  if (!needsResize) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close?.(); return file; }

    // White underneath: a transparent PNG flattened onto a JPEG's default black
    // would turn a scanned white page into a black one.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    for (const quality of QUALITY_STEPS) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality),
      );
      if (!blob) break;
      // Keep going only while still too big; the first fitting result wins, so
      // we never degrade further than necessary.
      if (blob.size <= VAULT_MAX_BYTES) {
        // A "compressed" file bigger than the original is a real outcome for
        // small or already-optimised images. Refuse our own work in that case.
        if (blob.size >= file.size) return file;
        return new File([blob], renameToJpg(file.name), {
          type: 'image/jpeg',
          lastModified: file.lastModified,
        });
      }
    }

    return file;
  } catch {
    // Undecodable format, cross-origin taint, out of memory on a low-end phone.
    // All of them mean the same thing here: upload what the user picked.
    return file;
  }
}

/** `scan.png` → `scan.jpg`. The bytes are JPEG now; the name has to agree. */
function renameToJpg(name: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.jpg`;
}
