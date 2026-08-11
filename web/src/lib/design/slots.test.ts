/**
 * Run: node --experimental-strip-types src/lib/design/slots.test.ts
 * CI picks this up via the existing web/src/lib/**\/*.test.ts glob.
 *
 * Boundaries are worth testing because they are off-by-one bait, and because the
 * same four numbers have to be reproduced in Kotlin later — a failing test here
 * is the cheapest way to notice the two have drifted.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { slotForHour, slotForDose, groupBySlot, SLOTS } from './slots.ts';

/**
 * THE SHARED FIXTURE — test/slot-test-vectors.json.
 *
 * Same pattern and same reason as schedule-test-vectors.json: the Kotlin alarm
 * core will implement these boundaries too (to tint the alarm ground by dose
 * time), and two implementations of one rule drift. calculateNextReminder already
 * proved that — its two "lockstep" JS copies had silently diverged.
 *
 * Share the tests, not the code. When the Kotlin port lands it reads THIS file.
 */
const vectorsPath = fileURLToPath(new URL('../../../../test/slot-test-vectors.json', import.meta.url));
const fixture = JSON.parse(readFileSync(vectorsPath, 'utf8')) as {
  vectors: { name: string; scheduledFor: string; timezone: string | null; expectedSlot: string | null }[];
};

test('shared fixture: every vector assigns the expected slot', () => {
  assert.ok(fixture.vectors.length >= 20, 'fixture looks truncated');
  for (const v of fixture.vectors) {
    const actual = slotForDose(v.scheduledFor, v.timezone);
    assert.ok(actual, `${v.name}: returned nothing`);
    if (v.expectedSlot === null) {
      // Engine-local by design (no timezone, or an unknown one). The contract is
      // "returns a slot and never throws", not a specific bucket.
      assert.ok(SLOTS.some((s) => s.id === actual.id), `${v.name}: not a real slot`);
      continue;
    }
    assert.equal(actual.id, v.expectedSlot, `${v.name}: expected ${v.expectedSlot}, got ${actual.id}`);
  }
});

test('every hour of the day lands in exactly one slot', () => {
  for (let h = 0; h < 24; h += 1) {
    const slot = slotForHour(h);
    assert.ok(slot, `hour ${h} had no slot`);
    assert.ok(SLOTS.some((s) => s.id === slot.id));
  }
});

test('boundaries are inclusive at the start of each slot', () => {
  assert.equal(slotForHour(0).id, 'morning');
  assert.equal(slotForHour(10).id, 'morning');
  assert.equal(slotForHour(11).id, 'midday');
  assert.equal(slotForHour(15).id, 'midday');
  assert.equal(slotForHour(16).id, 'evening');
  assert.equal(slotForHour(20).id, 'evening');
  assert.equal(slotForHour(21).id, 'night');
  assert.equal(slotForHour(23).id, 'night');
});

test('a 3am dose is slotted rather than lost', () => {
  // Deliberate: night-shift and strict-interval antibiotic doses are real.
  assert.equal(slotForHour(3).id, 'morning');
});

test("uses the medication's timezone, not the runtime's", () => {
  // 02:30 UTC is 08:00 in Kolkata — a morning dose for an Indian patient even if
  // the phone is in London. Tinting this "morning" is the whole point.
  const utcInstant = '2026-08-12T02:30:00Z';
  assert.equal(slotForDose(utcInstant, 'Asia/Kolkata').id, 'morning'); // 08:00 IST
  // The same instant is 19:30 the previous day in Los Angeles — evening, not night.
  // (This assertion was wrong on first write: a reminder that "the other side of
  // the world" is not automatically the opposite end of the day.)
  assert.equal(slotForDose(utcInstant, 'America/Los_Angeles').id, 'evening');
});

test('legacy IANA alias behaves like the canonical name', () => {
  const instant = '2026-08-12T14:30:00Z'; // 20:00 IST
  assert.equal(
    slotForDose(instant, 'Asia/Calcutta').id,
    slotForDose(instant, 'Asia/Kolkata').id,
  );
});

test('bad input never throws inside a render', () => {
  assert.equal(slotForDose('not-a-date', 'Asia/Kolkata').id, 'morning');
  assert.equal(slotForDose('2026-08-12T08:00:00Z', 'Not/AZone').id !== undefined, true);
});

test('groupBySlot keeps slot order and drops empty slots', () => {
  const doses = [
    { at: '2026-08-12T16:30:00Z', tz: 'Asia/Kolkata' }, // 22:00 -> night
    { at: '2026-08-12T02:30:00Z', tz: 'Asia/Kolkata' }, // 08:00 -> morning
  ];
  const grouped = groupBySlot(doses, (d) => d.at, (d) => d.tz);
  assert.deepEqual(grouped.map((g) => g.slot.id), ['morning', 'night']);
  assert.equal(grouped.length, 2, 'empty slots should not render a rail segment');
});
