/**
 * Health Vault upload limits — the numbers and the sentences, in one place.
 *
 * THESE ARE THE POLITENESS LAYER, NOT THE LIMIT. The real refusal happens in the
 * database and the Storage API (migration_vault_upload_limits_2026_08_13.sql):
 * the browser uploads straight to Supabase Storage, so anything checked here can
 * be skipped by anyone who does not use our form — which is the only person worth
 * defending against. What this file buys is that a legitimate user finds out
 * BEFORE waiting through an upload that was always going to be rejected.
 *
 * Keep VAULT_MAX_FILES, VAULT_MAX_BYTES and VAULT_ALLOWED_MIME in lockstep with
 * that migration. If they drift, the drift is silent and lands on the user as a
 * failed upload the form promised would work.
 */

/** Per user, across every folder, counted as STORAGE OBJECTS — trash included. */
export const VAULT_MAX_FILES = 5;

/** 5 MB. Matches storage.buckets.file_size_limit for the health-vault bucket. */
export const VAULT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Images and PDFs. Narrowed 2026-08-13 from a list that also took .doc/.docx/
 * .txt/.zip — a vault holds prescriptions and reports, and an opaque archive is
 * not one. Files of the old types that are already stored still open normally;
 * only new uploads are affected.
 */
export const VAULT_ALLOWED_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

/** What the file picker offers, and what a dropped file is checked against. */
export const VAULT_ALLOWED_EXTENSIONS = [
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif',
] as const;

/** The `accept` attribute for the file input — same list, one source. */
export const VAULT_ACCEPT_ATTR = VAULT_ALLOWED_EXTENSIONS.join(',');

/** Human-facing list, for the "you can add…" line. Not the enforcement list. */
export const VAULT_ALLOWED_LABEL = 'PDF, JPG, PNG, WEBP or HEIC';

/** How many more this user may add. Never negative, even if they are over. */
export function slotsLeft(used: number): number {
  return Math.max(0, VAULT_MAX_FILES - used);
}

/** How many they must remove before another upload is possible. */
export function mustDeleteToUpload(used: number): number {
  return Math.max(0, used - (VAULT_MAX_FILES - 1));
}

export function atLimit(used: number): boolean {
  return used >= VAULT_MAX_FILES;
}

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Why an upload will not be accepted, or null when it will.
 *
 * Zero-blame and sentence case, per the copy constitution: it names what the file
 * IS and what the vault takes, and never tells anyone they did something wrong.
 * "Unsupported file extension (.zip)" was accurate and read like a rejection
 * slip; someone photographing a prescription in a clinic corridor deserves the
 * version that just says what to do.
 */
export function fileRejectionReason(file: { name: string; size: number }): string | null {
  return unsupportedTypeReason(file.name) ?? oversizeReason(file.size);
}

/**
 * Checked on the file the user PICKED, before any compression.
 *
 * Order matters: compression rewrites a photo to .jpg, so running this after it
 * would quietly launder a disallowed type into an allowed one — a .gif would
 * arrive as a .jpg and pass a list it is not on. The allow-list has to see what
 * the user actually chose.
 */
export function unsupportedTypeReason(fileName: string): string | null {
  const ext = '.' + (fileName.split('.').pop() || '').toLowerCase();
  if (!(VAULT_ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return `The vault takes ${VAULT_ALLOWED_LABEL} files. That one is a ${ext} file.`;
  }
  return null;
}

/**
 * Checked AFTER compression, on what would actually be uploaded — otherwise
 * every ordinary camera photo would be refused before we had shrunk it.
 * Reaching here means a PDF, or an image the browser could not decode.
 */
export function oversizeReason(size: number): string | null {
  if (size > VAULT_MAX_BYTES) {
    return `That file is ${mb(size)}. Each document needs to be under ${mb(VAULT_MAX_BYTES)}.`;
  }
  return null;
}

/**
 * The line shown wherever the vault reports how full it is.
 *
 * `trashed` is counted separately and said out loud because it is the one part a
 * user cannot guess: the file is out of sight but the bytes are still stored, so
 * it still holds a slot until the trash is emptied or 30 days pass. Hiding that
 * would leave someone staring at "5 of 5" having just deleted something.
 */
export function vaultUsageCopy(used: number, trashed = 0): string {
  const base = `${used} of ${VAULT_MAX_FILES} used`;
  return trashed > 0 ? `${base} · ${trashed} in trash` : base;
}

/** Shown in place of the upload control once there is no room. */
export function vaultFullCopy(used: number, trashed = 0): string {
  const n = mustDeleteToUpload(used);
  const remove = n === 1 ? 'Delete one' : `Delete ${n}`;
  const base = `You can keep ${VAULT_MAX_FILES} documents. ${remove} to add another.`;
  return trashed > 0
    ? `${base} Files in the trash still take up a place — delete one permanently to free it now.`
    : base;
}
