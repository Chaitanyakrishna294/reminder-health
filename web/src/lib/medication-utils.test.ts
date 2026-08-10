// Dependency-free checks. Run:
//   node --experimental-strip-types src/lib/medication-utils.test.ts
//
// Runs the shared fixture (../../../test/schedule-test-vectors.json) against
// this file's calculateNextReminder — the same fixture the bot runs against
// src/utils.js (test/utils.test.js) and that the Android Kotlin port must
// pass before it ships (see CLAUDE.md's Android section). A mismatch here
// means this "lockstep" mirror has drifted from the bot again.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { calculateNextReminder } from './medication-utils.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, '../../../test/schedule-test-vectors.json');
const { vectors } = JSON.parse(readFileSync(fixturePath, 'utf8'));

for (const v of vectors) {
  if (v.expectThrow) {
    assert.throws(() => calculateNextReminder(v.reminderTimes, v.timezone, v.doseDays, v.now));
  } else {
    const result = calculateNextReminder(v.reminderTimes, v.timezone, v.doseDays, v.now);
    assert.strictEqual(result.toISOString(), v.expectedUtc, v.name);
  }
}

console.log(`medication-utils: all ${vectors.length} fixture vectors passed`);
