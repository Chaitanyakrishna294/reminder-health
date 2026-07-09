// Self-contained check for the shared scheduling primitives. No framework:
//   node --experimental-strip-types src/lib/schedule/dose-engine.test.ts
// Fails loudly (non-zero exit) if any invariant breaks.
import assert from 'node:assert';
import { parseTimeToMinutes, findOverride, toOverrideDateStr, type OverrideEntry } from './dose-engine.ts';

// ── parseTimeToMinutes: 24h, 12h am/pm, and the classic 12:00 edges ──
assert.equal(parseTimeToMinutes('08:00'), 8 * 60);
assert.equal(parseTimeToMinutes('23:59'), 23 * 60 + 59);
assert.equal(parseTimeToMinutes('00:00'), 0);
assert.equal(parseTimeToMinutes('1:05 pm'), 13 * 60 + 5);
assert.equal(parseTimeToMinutes('12:30 pm'), 12 * 60 + 30); // noon stays 12
assert.equal(parseTimeToMinutes('12:30 am'), 30); // midnight wraps to 0
assert.equal(parseTimeToMinutes('12:30AM'), 30); // no space, uppercase
// Unparseable / out-of-range inputs → null, never NaN
assert.equal(parseTimeToMinutes(''), null);
assert.equal(parseTimeToMinutes('25:00'), null);
assert.equal(parseTimeToMinutes('10:75'), null);
assert.equal(parseTimeToMinutes('13:00 pm'), 13 * 60); // redundant pm on 24h time is ignored
assert.equal(parseTimeToMinutes('8am'), null); // minutes required

// ── findOverride: matches on medication + day, first match wins ──
const overrides: OverrideEntry[] = [
  { medicationId: 1, dateStr: '2026-07-07', overriddenTime: '09:30' },
  { medicationId: 1, dateStr: '2026-07-08', isSkipped: true },
  { medicationId: 2, dateStr: '2026-07-07', isSkipped: true },
];
assert.equal(findOverride(overrides, 1, '2026-07-07')?.overriddenTime, '09:30');
assert.equal(findOverride(overrides, 1, '2026-07-08')?.isSkipped, true);
assert.equal(findOverride(overrides, 2, '2026-07-08'), undefined);
assert.equal(findOverride([], 1, '2026-07-07'), undefined);

// ── toOverrideDateStr: planner and dashboard must derive the SAME key from the
// same instant, regardless of the machine's local timezone. (Both key by UTC
// date; an override saved by the planner must be found by the dashboard.) ──
const instant = new Date('2026-07-07T20:30:00.000Z');
assert.equal(toOverrideDateStr(instant), '2026-07-07');
assert.equal(toOverrideDateStr(new Date(instant)), toOverrideDateStr(instant));
// Late-evening IST (early next day locally) still keys by the UTC date, so
// both callers agree even across the midnight boundary.
assert.equal(toOverrideDateStr(new Date('2026-07-07T23:59:59.999Z')), '2026-07-07');
assert.equal(toOverrideDateStr(new Date('2026-07-08T00:00:00.000Z')), '2026-07-08');

console.log('dose-engine: all checks passed');
