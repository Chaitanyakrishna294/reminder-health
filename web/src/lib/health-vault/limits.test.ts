// Self-contained check for the Health Vault limit arithmetic and copy.
//   node --experimental-strip-types src/lib/health-vault/limits.test.ts
// Fails loudly (non-zero exit) if any invariant breaks.
//
// Worth testing despite being small: `mustDeleteToUpload` is off-by-one bait —
// the rule the database enforces is `count < 5`, NOT `count <= 5`, so someone
// sitting on exactly five must delete one, and someone on seven must delete
// three, not two. Getting that wrong tells a user to delete a medical document
// for no reason, which is the kind of mistake that has to be caught here rather
// than in a clinic corridor.
import assert from 'node:assert';
import {
  VAULT_MAX_BYTES,
  VAULT_MAX_FILES,
  VAULT_ALLOWED_EXTENSIONS,
  VAULT_ALLOWED_MIME,
  VAULT_ACCEPT_ATTR,
  VAULT_CAMERA_ACCEPT,
  atLimit,
  mustDeleteToUpload,
  oversizeReason,
  slotsLeft,
  unsupportedTypeReason,
  vaultFullCopy,
  vaultUsageCopy,
} from './limits.ts';

// ── The numbers must match the migration ──
// If either of these changes, migration_vault_upload_limits_2026_08_13.sql and
// its validation change in the same commit or the form promises what the server
// refuses.
assert.equal(VAULT_MAX_FILES, 5);
assert.equal(VAULT_MAX_BYTES, 5242880, '5 MB, same integer as storage.buckets.file_size_limit');

// ── slotsLeft / atLimit ──
assert.equal(slotsLeft(0), 5);
assert.equal(slotsLeft(4), 1);
assert.equal(slotsLeft(5), 0);
assert.equal(slotsLeft(9), 0, 'never negative — legacy accounts can be over');
assert.equal(atLimit(4), false);
assert.equal(atLimit(5), true);
assert.equal(atLimit(9), true);

// ── mustDeleteToUpload — the off-by-one ──
assert.equal(mustDeleteToUpload(4), 0, 'room already');
assert.equal(mustDeleteToUpload(5), 1, 'at the limit: one delete gets you to 4, and 4 < 5');
assert.equal(mustDeleteToUpload(7), 3, 'seven files means three deletes, not two');

// ── Type check runs on what the user PICKED ──
for (const ext of VAULT_ALLOWED_EXTENSIONS) {
  assert.equal(unsupportedTypeReason(`scan${ext}`), null, `${ext} should be accepted`);
}
for (const name of ['archive.zip', 'notes.txt', 'report.doc', 'sheet.xlsx', 'clip.mp4', 'noextension']) {
  assert.notEqual(unsupportedTypeReason(name), null, `${name} must be refused`);
}
// Case and path noise must not sneak a type past the list.
assert.equal(unsupportedTypeReason('SCAN.PDF'), null, 'extension check is case-insensitive');
assert.notEqual(unsupportedTypeReason('evil.pdf.zip'), null, 'only the LAST extension counts');

// ── Size check runs on what would be uploaded ──
assert.equal(oversizeReason(VAULT_MAX_BYTES), null, 'exactly at the ceiling is allowed');
assert.notEqual(oversizeReason(VAULT_MAX_BYTES + 1), null, 'one byte over is not');
assert.match(oversizeReason(6 * 1024 * 1024)!, /6\.0 MB/, 'says how big the file actually is');

// ── Copy: sentence case, no blame, and it names the way out ──
assert.equal(vaultUsageCopy(3), '3 of 5 used');
assert.equal(vaultUsageCopy(5, 2), '5 of 5 used · 2 in trash');
assert.match(vaultFullCopy(5), /Delete one to add another/);
assert.match(vaultFullCopy(7), /Delete 3 to add another/);
// The trash sentence appears only when there IS trash — it is the one fact a
// user cannot deduce from the screen, and noise the rest of the time.
assert.ok(!vaultFullCopy(5).includes('trash'));
assert.match(vaultFullCopy(5, 1), /trash/);

for (const copy of [vaultFullCopy(5), vaultFullCopy(7, 2), oversizeReason(9e6)!, unsupportedTypeReason('a.zip')!]) {
  assert.ok(!/[A-Z]{2,}/.test(copy.replace(/\bMB\b|\bPDF\b|\bJPG\b|\bPNG\b|\bWEBP\b|\bHEIC\b/g, '')),
    `no shouting in: ${copy}`);
  assert.ok(!/you (must|cannot|can't|failed|error)/i.test(copy), `zero-blame violated in: ${copy}`);
}

// ── Camera capture: the exact token Capacitor tests for ──
// BridgeWebChromeClient.onShowFileChooser routes to the camera only when
// `capture` is set AND acceptTypes.contains("image/*") — LIST MEMBERSHIP, so
// `image/jpeg` or any narrower value silently falls back to the document picker
// with no camera at all. That was the bug; this asserts it stays fixed.
assert.equal(VAULT_CAMERA_ACCEPT, 'image/*');

// ── The choose-a-file accept list must NOT carry image/* ──
// It would widen that picker to .gif/.bmp we then refuse, and it is the camera
// input's distinguishing token.
assert.ok(!VAULT_ACCEPT_ATTR.split(',').includes('image/*'));
assert.ok(!VAULT_ACCEPT_ATTR.includes('.zip'));
// Extensions AND MIME types: Android's document picker filters on MIME and its
// extension→MIME mapping is patchy for .heic.
for (const ext of VAULT_ALLOWED_EXTENSIONS) assert.ok(VAULT_ACCEPT_ATTR.split(',').includes(ext));
for (const m of VAULT_ALLOWED_MIME) assert.ok(VAULT_ACCEPT_ATTR.split(',').includes(m));

// ── Camera files whose name lost its extension ──
// A captured photo can arrive as `image` or a bare content-URI name depending on
// the device's camera app. Refusing someone's photograph of their own
// prescription because the suffix went missing would break the front door.
assert.equal(unsupportedTypeReason('image', 'image/jpeg'), null);
assert.equal(unsupportedTypeReason('IMG_20260813', 'image/heic'), null);
// But MIME is only a FALLBACK. It is attacker-controlled, so a real extension
// always wins — a .zip claiming to be a PNG stays refused.
assert.notEqual(unsupportedTypeReason('payload.zip', 'image/png'), null);
assert.notEqual(unsupportedTypeReason('doc.docx', 'image/jpeg'), null);
// No extension and no usable type is still a refusal, with its own wording.
assert.match(unsupportedTypeReason('mystery', '')!, /no file type we recognise/);
assert.match(unsupportedTypeReason('mystery', 'application/zip')!, /no file type we recognise/);

console.log('limits.test.ts: all assertions passed');
