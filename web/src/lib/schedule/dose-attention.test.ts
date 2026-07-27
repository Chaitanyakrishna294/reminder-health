// Self-contained check for the missed-dose attention partition. No framework:
//   node --experimental-strip-types src/lib/schedule/dose-attention.test.ts
// Fails loudly (non-zero exit) if any invariant breaks.
import assert from 'node:assert';
import {
  isAttentionStatus,
  isPendingStatus,
  partitionDoseAttention,
  buildGateQueue,
} from './dose-attention.ts';

const ev = (id: number, iso: string, status: string) => ({
  id,
  scheduled_for: iso,
  reminder_status: status,
});
const NOW = new Date('2026-07-27T12:00:00.000Z').getTime();

// ── Status classification ──
// Attention = the missed backlog the user must be confronted with.
for (const s of ['MISSED', 'PENDING_REVIEW', 'UNCONFIRMED']) {
  assert.equal(isAttentionStatus(s), true, `${s} should be attention`);
  assert.equal(isPendingStatus(s), false, `${s} must NOT be pending`);
}
// Pending = still on its normal path (virtual + real fired-but-unresolved).
for (const s of ['FUTURE_SCHEDULED', 'SENT', 'GENTLE_REMINDER', 'ESCALATED', 'SNOOZED']) {
  assert.equal(isPendingStatus(s), true, `${s} should be pending`);
  assert.equal(isAttentionStatus(s), false, `${s} must NOT be attention`);
}
// Resolved doses belong to neither bucket.
for (const s of ['TAKEN', 'SKIPPED', 'RESOLVED_BY_CG']) {
  assert.equal(isAttentionStatus(s), false);
  assert.equal(isPendingStatus(s), false);
}

// ── partitionDoseAttention: buckets + ascending sort, resolved dropped ──
const mixed = [
  ev(1, '2026-07-27T11:00:00.000Z', 'SENT'),            // due (pending, past)
  ev(2, '2026-07-27T08:00:00.000Z', 'MISSED'),          // attention, older
  ev(3, '2026-07-27T15:00:00.000Z', 'FUTURE_SCHEDULED'), // pending, future
  ev(4, '2026-07-27T06:00:00.000Z', 'PENDING_REVIEW'),  // attention, oldest
  ev(5, '2026-07-27T07:00:00.000Z', 'TAKEN'),           // resolved → neither
];
const { attention, pending } = partitionDoseAttention(mixed);
assert.deepEqual(attention.map(e => e.id), [4, 2]); // oldest first
assert.deepEqual(pending.map(e => e.id), [1, 3]);   // ascending
assert.equal([...attention, ...pending].some(e => e.id === 5), false);

// ── buildGateQueue: present doses first, missed backlog after ──
// Even though the MISSED doses are OLDER, the due-now pending dose leads –
// it is the dose the user opened the app for.
assert.deepEqual(buildGateQueue(mixed, NOW, {}).map(e => e.id), [1, 4, 2]);

// Future pending doses never enter the queue.
assert.equal(buildGateQueue(mixed, NOW, {}).some(e => e.id === 3), false);

// ── Snooze filter: suppressed while active, back after expiry ──
assert.deepEqual(
  buildGateQueue(mixed, NOW, { 1: NOW + 60_000 }).map(e => e.id),
  [4, 2],
  'actively snoozed dose is suppressed'
);
assert.deepEqual(
  buildGateQueue(mixed, NOW, { 1: NOW - 1 }).map(e => e.id),
  [1, 4, 2],
  'expired snooze no longer suppresses'
);

// ── Empty input ──
assert.deepEqual(partitionDoseAttention([]), { attention: [], pending: [] });
assert.deepEqual(buildGateQueue([], NOW, {}), []);

console.log('dose-attention: all assertions passed');
