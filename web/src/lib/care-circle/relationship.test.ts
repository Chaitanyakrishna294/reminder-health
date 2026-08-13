// Self-contained check for care-circle relationship language.
//   node --experimental-strip-types src/lib/care-circle/relationship.test.ts
//
// This is copy about family shown to an anxious reader, and the failure mode is
// silent: a wrong label does not throw, it just tells a patient something untrue
// about who can see their medication list.
import assert from 'node:assert';
import { connectionStateCopy } from './relationship.ts';

// ── The bug this replaced ──
// The cards rendered `connection_status` raw, so these exact strings reached a
// patient's screen. Nothing here may return a database value.
for (const status of ['ACCEPTED', 'PENDING', 'REJECTED', 'SOMETHING_ELSE', '']) {
  for (const active of [true, false]) {
    const { label } = connectionStateCopy(status, active);
    assert.ok(!/^[A-Z_]+$/.test(label), `raw enum leaked for ${status}: ${label}`);
    // Sentence case: capital first letter, no SHOUTING inside.
    assert.ok(!/\b[A-Z]{2,}\b/.test(label), `shouting in: ${label}`);
    assert.equal(label[0], label[0].toUpperCase(), `not sentence case: ${label}`);
  }
}

// ── Accepted depends on whether it is still live ──
assert.deepEqual(connectionStateCopy('ACCEPTED', true), { label: 'Connected', tone: 'success' });
// An accepted-but-inactive link is NOT "Connected" — saying so would tell someone
// they have a caregiver watching when nobody is.
assert.equal(connectionStateCopy('ACCEPTED', false).label, 'Paused');
assert.equal(connectionStateCopy('ACCEPTED', false).tone, 'neutral');

// ── Pending says whose turn it is, which the enum never did ──
assert.match(connectionStateCopy('PENDING', false).label, /waiting for them/i);
assert.equal(connectionStateCopy('PENDING', false).tone, 'warning');

// ── Declined is neutral, not danger ──
// Someone declining an invitation is an outcome, not a failure, and a red badge
// on a family member's name reads as an alarm.
assert.equal(connectionStateCopy('REJECTED', false).tone, 'neutral');

// ── Case and junk ──
assert.equal(connectionStateCopy('accepted', true).label, 'Connected');
assert.equal(connectionStateCopy('', true).label, 'Not connected');
assert.equal(connectionStateCopy('WAT', true).label, 'Not connected');

// ── Never colour-only ──
// Every state carries a distinct WORD, so the badge is readable without colour.
const labels = ['ACCEPTED', 'PENDING', 'REJECTED', 'WAT'].map(
  (s) => connectionStateCopy(s, true).label,
);
assert.equal(new Set(labels).size, labels.length, `states must not share a word: ${labels}`);

console.log('relationship.test.ts: all assertions passed');
