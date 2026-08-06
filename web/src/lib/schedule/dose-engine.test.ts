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

// ── toOverrideDateStr: the key is the viewer's LOCAL calendar date. The planner
// and the dashboard must derive the SAME key from the same instant on any
// machine, so all expectations below are built from local date parts (never
// from UTC instants — keying by toISOString was the bug: in IST it shifted
// local-midnight dates and pre-05:30 times onto the previous UTC day). ──
// A date built at local midnight (exactly what the planner's month grid makes)
// keys to that same local day — in IST the old UTC keying said the day before.
assert.equal(toOverrideDateStr(new Date(2026, 6, 7)), '2026-07-07');
// Late evening local time is still the same local day.
assert.equal(toOverrideDateStr(new Date(2026, 6, 7, 20, 30)), '2026-07-07');
// The last local millisecond of the day and the first of the next stay on
// their own sides of local midnight.
assert.equal(toOverrideDateStr(new Date(2026, 6, 7, 23, 59, 59, 999)), '2026-07-07');
assert.equal(toOverrideDateStr(new Date(2026, 6, 8, 0, 0, 0, 0)), '2026-07-08');
// Two different Date objects for the same local day agree (planner's grid date
// at midnight vs the dashboard's "now" mid-afternoon) — the shared-key contract.
assert.equal(toOverrideDateStr(new Date(2026, 6, 7)), toOverrideDateStr(new Date(2026, 6, 7, 14, 5)));
// Single-digit month/day are zero-padded to a stable YYYY-MM-DD shape.
assert.equal(toOverrideDateStr(new Date(2026, 0, 3)), '2026-01-03');

console.log('dose-engine: all checks passed');
