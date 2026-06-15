const test = require('node:test');
const assert = require('node:assert');
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

test('isValidTime accepts HH:MM 24h and rejects malformed input', () => {
  assert.ok(isValidTime('00:00'));
  assert.ok(isValidTime('23:59'));
  assert.ok(!isValidTime('24:00'));
  assert.ok(!isValidTime('9:00'));
  assert.ok(!isValidTime('12:60'));
});
