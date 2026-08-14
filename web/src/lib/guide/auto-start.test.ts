// Whether a guided tour volunteers itself.
//   node --experimental-strip-types src/lib/guide/auto-start.test.ts
//
// The rule: an account that already holds medications never gets an auto tour.
// Before 2026-08-14 the only gate was a per-tour localStorage flag, and
// localStorage is per DEVICE — so a returning user on a new phone, after an APK
// reinstall, or with cleared storage was greeted by a tour explaining how to add
// their first medicine while looking at nineteen of them.
import assert from 'node:assert';
import { autoStartDecision } from './auto-start.ts';

// ── The case that prompted the change ──
// Established account, storage wiped: every flag says "new", the data does not.
assert.equal(
  autoStartDecision({ accountHasData: true, established: false, seen: false }),
  'suppress',
  'an account with medications is never new, whatever localStorage says',
);

// ── A genuinely new account still gets its tour ──
assert.equal(
  autoStartDecision({ accountHasData: false, established: false, seen: false }),
  'start',
);

// ── Once per device, as before ──
assert.equal(autoStartDecision({ accountHasData: false, established: false, seen: true }), 'skip');

// ── The wizard: cannot tell from here, so it defers ──
// `undefined` must NOT read as "no data" — that would make the add-medication
// page the one screen that still ambushes an established user.
assert.equal(
  autoStartDecision({ accountHasData: undefined, established: true, seen: false }),
  'skip',
  'an unknowing page honours what a knowing page concluded',
);
assert.equal(
  autoStartDecision({ accountHasData: undefined, established: false, seen: false }),
  'start',
  'and with nothing recorded anywhere, it behaves as before',
);

// ── Suppression outranks seen-ness in both directions ──
// It has to also fire when `seen` is already true: 'suppress' is what writes the
// established flag, and that flag is the only thing the wizard can read.
assert.equal(autoStartDecision({ accountHasData: true, established: true, seen: true }), 'suppress');

// ── Emptying the list does not resurface a tour ──
// A user who deletes every medication has `accountHasData: false`, but a
// previous render already recorded `established`, so the answer stays no.
assert.equal(
  autoStartDecision({ accountHasData: false, established: true, seen: false }),
  'skip',
  'deleting your medications does not make you a beginner again',
);

console.log('auto-start.test.ts: all assertions passed');
