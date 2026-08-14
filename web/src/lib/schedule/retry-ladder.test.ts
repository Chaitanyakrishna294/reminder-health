// The web half of the shared retry-ladder fixture.
//   node --experimental-strip-types src/lib/schedule/retry-ladder.test.ts
//
// Reads test/retry-ladder-vectors.json — the SAME file the Kotlin RetryLadder
// test will read. That is the point: this file asserts nothing of its own, so a
// case can only be added in one place and both implementations are held to it.
// The `calculateNextReminder` pair drifted precisely because each side had its
// own tests.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_LADDERS,
  RETRY_CAP_MINUTES,
  isConfigurable,
  ladderError,
  remainingOffsets,
  retryOffsets,
  retryWindowMinutes,
} from './retry-ladder.ts';

const vectors = JSON.parse(
  readFileSync(new URL('../../../../test/retry-ladder-vectors.json', import.meta.url), 'utf8'),
);

// The fixture states the cap too, so a change in one file that is not made in
// the other fails here rather than at 3am on somebody's phone.
assert.equal(RETRY_CAP_MINUTES, vectors.capMinutes, 'cap disagrees with the fixture');

let checked = 0;

for (const v of [...vectors.defaults, ...vectors.custom]) {
  assert.deepEqual(retryOffsets(v.priority, v.config), v.expectedOffsets, v.name);
  assert.equal(retryWindowMinutes(v.priority, v.config), v.expectedWindow, `window: ${v.name}`);
  checked += 2;
}

for (const v of vectors.validation) {
  const err = ladderError(v.interval, v.count);
  assert.equal(err === null, v.valid, `${v.name} (got: ${err ?? 'valid'})`);
  // An invalid pair must SAY why — a silent rejection on a settings form is a
  // control that appears broken.
  if (!v.valid) assert.ok((err ?? '').length > 0, `no message for: ${v.name}`);
  checked++;
}

for (const v of vectors.cancellation) {
  assert.deepEqual(remainingOffsets(v.offsets, v.resolvedAtMinute), v.expectedCancelled, v.name);
  checked++;
}

// ── Invariants the fixture cannot express as data ──

// Every default must itself be valid. A default that violates the cap would be
// unreachable through the form and unfixable through it.
for (const [priority, cfg] of Object.entries(DEFAULT_LADDERS)) {
  assert.equal(ladderError(cfg.interval, cfg.count), null, `default for ${priority} is invalid`);
  assert.ok(cfg.interval * cfg.count <= RETRY_CAP_MINUTES, `default for ${priority} exceeds the cap`);
}

// No ladder may ever reach the escalation clamp, whatever the config says.
for (const v of [...vectors.defaults, ...vectors.custom]) {
  assert.ok(
    retryWindowMinutes(v.priority, v.config) <= RETRY_CAP_MINUTES,
    `window exceeds the cap: ${v.name}`,
  );
}

// Offsets ascend and never repeat — the scheduler chains them in order, and a
// duplicate would be two alarms at one instant for one dose.
for (const v of [...vectors.defaults, ...vectors.custom]) {
  const o = retryOffsets(v.priority, v.config);
  for (let i = 1; i < o.length; i++) {
    assert.ok(o[i] > o[i - 1], `offsets not strictly ascending: ${v.name}`);
  }
}

// Routine is deliberately fixed; the two that matter are configurable.
assert.equal(isConfigurable('normal'), false);
assert.equal(isConfigurable('important'), true);
assert.equal(isConfigurable('critical'), true);
assert.equal(isConfigurable(null), false, 'a missing priority must not open the controls');

console.log(`retry-ladder.test.ts: ${checked} fixture assertions passed`);
