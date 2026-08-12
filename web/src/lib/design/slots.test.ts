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
import {
  slotForHour, slotForDose, groupBySlot,
  dayKeyForDose, groupByDay, dayKeysEndingAt, timeOfDayForDose,
  SLOTS,
} from './slots.ts';

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
  vectors: {
    name: string;
    scheduledFor: string;
    timezone: string | null;
    expectedSlot: string | null;
    /** Absent = engine-local, do not assert. Explicit null = must return no day. */
    expectedDay?: string | null;
    /** What a naive UTC-date implementation would have produced. Never asserted. */
    utcDay?: string;
  }[];
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

test('shared fixture: every vector files under the expected DAY', () => {
  let asserted = 0;
  for (const v of fixture.vectors) {
    if (!('expectedDay' in v)) continue; // engine-local; nothing honest to assert
    const actual = dayKeyForDose(v.scheduledFor, v.timezone);
    assert.equal(actual, v.expectedDay, `${v.name}: expected ${v.expectedDay}, got ${actual}`);
    asserted += 1;
  }
  assert.ok(asserted >= 25, `only ${asserted} day vectors asserted — fixture looks truncated`);
});

test('shared fixture: every cross-day vector actually disagrees with the UTC date', () => {
  // Guards the fixture itself. A `utcDay` that matches `expectedDay` would be a
  // vector that cannot fail for the naive implementation — it would sit in the file
  // looking like coverage of the exact bug it does not cover.
  let crossDay = 0;
  for (const v of fixture.vectors) {
    if (!v.utcDay) continue;
    assert.notEqual(v.utcDay, v.expectedDay, `${v.name}: utcDay equals expectedDay, so this vector proves nothing`);
    assert.equal(v.utcDay, v.scheduledFor.slice(0, 10), `${v.name}: utcDay does not match the instant's UTC date`);
    crossDay += 1;
  }
  assert.ok(crossDay >= 8, `only ${crossDay} cross-day vectors — the 00:00-05:29 IST window needs real coverage`);
});

test('a dose after midnight IST belongs to the new day, not the UTC one', () => {
  // The bug this whole module exists to prevent: 01:40 Asia/Kolkata is 20:10 UTC the
  // PREVIOUS day, so both the UTC date and a UTC-rendered viewer date file it under
  // yesterday — and the patient opens the app to find last night's dose missing.
  const instant = '2026-08-12T20:10:00Z';
  assert.equal(dayKeyForDose(instant, 'Asia/Kolkata'), '2026-08-13');
  assert.equal(instant.slice(0, 10), '2026-08-12', 'the naive answer, kept here to show the gap');
});

test('dayKeyForDose returns null only for an instant that does not exist', () => {
  assert.equal(dayKeyForDose('not-a-date', 'Asia/Kolkata'), null);
  // An unknown zone degrades to engine-local rather than returning null: the dose is
  // real and must still appear on some day.
  assert.ok(dayKeyForDose('2026-08-12T08:00:00Z', 'Not/AZone'));
});

test('groupByDay buckets per item timezone, not one reference zone', () => {
  // Same instant, two medications, two zones — and two different days. Bucketing
  // both by the first medication's zone would put the LA dose on the wrong date.
  const doses = [
    { at: '2026-08-12T02:30:00Z', tz: 'Asia/Kolkata' },       // 08:00 on the 12th
    { at: '2026-08-12T02:30:00Z', tz: 'America/Los_Angeles' }, // 19:30 on the 11th
  ];
  const { byDay, undated } = groupByDay(doses, (d) => d.at, (d) => d.tz);
  assert.deepEqual(Object.keys(byDay).sort(), ['2026-08-11', '2026-08-12']);
  assert.equal(undated.length, 0);
});

test('groupByDay sets undated aside rather than dropping it silently', () => {
  const { byDay, undated } = groupByDay(
    [{ at: 'not-a-date', tz: 'Asia/Kolkata' }],
    (d) => d.at,
    (d) => d.tz,
  );
  assert.deepEqual(byDay, {});
  assert.equal(undated.length, 1, 'a dose with no parseable day must be reportable, not vanished');
});

test('dayKeysEndingAt walks back over month, year and DST boundaries', () => {
  assert.deepEqual(dayKeysEndingAt('2026-08-13', 3), ['2026-08-11', '2026-08-12', '2026-08-13']);
  assert.deepEqual(dayKeysEndingAt('2026-09-01', 2), ['2026-08-31', '2026-09-01']);
  assert.deepEqual(dayKeysEndingAt('2027-01-01', 2), ['2026-12-31', '2027-01-01']);
  // 2026-03-08 is US spring-forward. A 23-hour day must not swallow a date.
  assert.deepEqual(dayKeysEndingAt('2026-03-09', 3), ['2026-03-07', '2026-03-08', '2026-03-09']);
  // 2026-11-01 is US fall-back — a 25-hour day must not duplicate one either.
  assert.deepEqual(dayKeysEndingAt('2026-11-02', 3), ['2026-10-31', '2026-11-01', '2026-11-02']);
  assert.equal(dayKeysEndingAt('2026-08-13', 7).length, 7);
  assert.deepEqual(dayKeysEndingAt('not-a-key', 3), []);
});

test('dayKeysEndingAt yields strictly consecutive, ascending keys', () => {
  const keys = dayKeysEndingAt('2026-03-09', 7);
  assert.equal(new Set(keys).size, keys.length, 'a repeated key would render two identical date cells');
  assert.deepEqual([...keys].sort(), keys, 'oldest first — the row reads left to right');
});

test('timeOfDayForDose prints the dose\'s own clock, not the viewer\'s', () => {
  // 02:30 UTC is 08:00 in Kolkata. A record that says "02:30" for a dose the patient
  // was reminded about at 08:00 is a wrong adherence record, not a display quirk.
  assert.equal(timeOfDayForDose('2026-08-12T02:30:00Z', 'Asia/Kolkata'), '08:00');
  assert.equal(timeOfDayForDose('2026-08-12T20:10:00Z', 'Asia/Kolkata'), '01:40');
  assert.equal(timeOfDayForDose('not-a-date', 'Asia/Kolkata'), '');
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
