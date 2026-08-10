const test = require('node:test');
const assert = require('node:assert');
const moment = require('moment-timezone');
const { calculateNextReminder, DEFAULT_TIMEZONE, isValidTime } = require('../src/utils');

// calculateNextReminder is the heart of "when does a dose fire" — guard its
// timezone behavior so a non-IST medication never silently fires ~hours off.

test('defaults to Asia/Kolkata when no timezone is given', () => {
  // 09:00 IST == 03:30 UTC, so the returned UTC minutes must be 30.
  const d = calculateNextReminder(['09:00']);
  assert.strictEqual(d.getUTCMinutes(), 30);
});

test('honors an explicit non-IST timezone', () => {
  // 09:00 America/New_York is on the hour in UTC (13:00 EDT / 14:00 EST),
  // i.e. minutes 0 — distinct from the IST result above.
  const d = calculateNextReminder(['09:00'], 'America/New_York');
  assert.strictEqual(d.getUTCMinutes(), 0);
});

test('same wall-clock time in different zones yields different instants', () => {
  const ist = calculateNextReminder(['12:00'], 'Asia/Kolkata');
  const ny = calculateNextReminder(['12:00'], 'America/New_York');
  assert.notStrictEqual(ist.getTime(), ny.getTime());
});

test('always returns a future instant', () => {
  const d = calculateNextReminder(['08:00', '14:00', '21:00'], DEFAULT_TIMEZONE);
  assert.ok(d.getTime() > Date.now(), 'next reminder must be in the future');
});

test('blank timezone falls back to the default', () => {
  const blank = calculateNextReminder(['09:00'], '   ');
  const def = calculateNextReminder(['09:00']);
  // Both resolve via IST → identical UTC minute-of-hour.
  assert.strictEqual(blank.getUTCMinutes(), def.getUTCMinutes());
});

// ── dose_days (non-daily schedules) ─────────────────────────────────────────
// The weekday rule must agree with occursOn in web/src/lib/schedule/dose-engine.ts
// and with the web mirror in web/src/lib/medication-utils.ts, or the dashboard
// draws a dose on a day the scheduler never sends one.
//
// These assert on the RESULT's weekday rather than on a fixed date, so they hold
// whatever day the suite happens to run.

/** Weekday (0=Sun..6=Sat) of a returned UTC Date, read back in the given tz. */
const weekdayIn = (date, tz) => moment(date).tz(tz).day();

test('dose_days omitted, null or empty all mean every day', () => {
  const base = calculateNextReminder(['09:00'], DEFAULT_TIMEZONE).getTime();
  assert.strictEqual(calculateNextReminder(['09:00'], DEFAULT_TIMEZONE, null).getTime(), base);
  assert.strictEqual(calculateNextReminder(['09:00'], DEFAULT_TIMEZONE, []).getTime(), base);
  assert.strictEqual(calculateNextReminder(['09:00'], DEFAULT_TIMEZONE, undefined).getTime(), base);
});

test('lands only on a listed weekday', () => {
  for (const days of [[1], [1, 3, 5], [0, 6], [2, 4]]) {
    const next = calculateNextReminder(['09:00'], DEFAULT_TIMEZONE, days);
    assert.ok(
      days.includes(weekdayIn(next, DEFAULT_TIMEZONE)),
      `expected a weekday in ${JSON.stringify(days)}, got ${weekdayIn(next, DEFAULT_TIMEZONE)}`,
    );
    assert.ok(next.getTime() > Date.now(), 'must still be in the future');
  }
});

test('a once-weekly med never schedules more than 7 days out', () => {
  // Worst case is "today is the dose day but the time has passed" — that must
  // land on the SAME weekday next week, not skip a fortnight.
  const today = moment().tz(DEFAULT_TIMEZONE).day();
  const next = calculateNextReminder(['00:01'], DEFAULT_TIMEZONE, [today]);
  assert.strictEqual(weekdayIn(next, DEFAULT_TIMEZONE), today);
  const daysOut = (next.getTime() - Date.now()) / 86400000;
  assert.ok(daysOut <= 7.01, `scheduled ${daysOut} days out, expected <= 7`);
});

test('every weekday selected behaves exactly like daily', () => {
  const all = calculateNextReminder(['09:00'], DEFAULT_TIMEZONE, [0, 1, 2, 3, 4, 5, 6]);
  const daily = calculateNextReminder(['09:00'], DEFAULT_TIMEZONE);
  assert.strictEqual(all.getTime(), daily.getTime());
});

test('dose_days keeps wall-clock time across zones', () => {
  // Same guarantee as the timezone tests above, but on the weekday path: 09:00
  // IST is minute 30 past the hour in UTC, 09:00 New York is on the hour.
  const ist = calculateNextReminder(['09:00'], 'Asia/Kolkata', [1, 4]);
  const ny = calculateNextReminder(['09:00'], 'America/New_York', [1, 4]);
  assert.strictEqual(ist.getUTCMinutes(), 30);
  assert.strictEqual(ny.getUTCMinutes(), 0);
});

test('a garbage dose_days set falls back to daily rather than never firing', () => {
  // The DB CHECK makes this unreachable, but for a medication reminder the
  // failure mode has to be "one dose too many", never "silently stops".
  const next = calculateNextReminder(['09:00'], DEFAULT_TIMEZONE, [9]);
  assert.ok(next.getTime() > Date.now());
  const daysOut = (next.getTime() - Date.now()) / 86400000;
  assert.ok(daysOut <= 2, `fallback scheduled ${daysOut} days out, expected within 2`);
});

test('multiple times on a due day pick the earliest still ahead', () => {
  const today = moment().tz(DEFAULT_TIMEZONE).day();
  const next = calculateNextReminder(['23:58', '23:59'], DEFAULT_TIMEZONE, [today]);
  assert.strictEqual(weekdayIn(next, DEFAULT_TIMEZONE), today);
});

test('isValidTime accepts HH:MM 24h and rejects malformed input', () => {
  assert.ok(isValidTime('00:00'));
  assert.ok(isValidTime('23:59'));
  assert.ok(!isValidTime('24:00'));
  assert.ok(!isValidTime('9:00'));
  assert.ok(!isValidTime('12:60'));
});

// ── shared fixture ──────────────────────────────────────────────────────────
// schedule-test-vectors.json is the golden-master fixture shared with the web
// mirror (web/src/lib/medication-utils.test.ts) and, eventually, the Android
// Kotlin port — see CLAUDE.md's Android section. Every expectedUtc in it was
// computed independently via moment-timezone, not by calling this function.

const { vectors } = require('./schedule-test-vectors.json');

for (const v of vectors) {
  test(`fixture: ${v.name}`, () => {
    if (v.expectThrow) {
      assert.throws(() => calculateNextReminder(v.reminderTimes, v.timezone, v.doseDays, v.now));
      return;
    }
    const result = calculateNextReminder(v.reminderTimes, v.timezone, v.doseDays, v.now);
    assert.strictEqual(result.toISOString(), v.expectedUtc);
  });
}
