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
import { slotForHour, slotForDose, groupBySlot, SLOTS } from './slots.ts';

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
