const test = require('node:test');
const assert = require('node:assert');
const { dosesPerDay, buildDoseKeyboard, buildTakePromptMessage } = require('../src/reminders');
const { CALLBACK_ACTIONS, MAX_SNOOZES } = require('../src/constants');

// These functions were extracted verbatim from scheduler.js's inline copies.
// The asserts below are characterization tests: they lock the *exact* prior
// behavior so the extraction is provably non-functional-changing.

test('dosesPerDay maps known frequencies and defaults unknown to 1', () => {
  assert.strictEqual(dosesPerDay('once_daily'), 1);
  assert.strictEqual(dosesPerDay('twice_daily'), 2);
  assert.strictEqual(dosesPerDay('thrice_daily'), 3);
  assert.strictEqual(dosesPerDay('weekly'), 1);
  assert.strictEqual(dosesPerDay(undefined), 1);
});

test('buildDoseKeyboard includes Snooze while under the cap', () => {
  const kb = buildDoseKeyboard(42, 1700000000000, 0);
  const row = kb.inline_keyboard[0];
  assert.strictEqual(row.length, 3);
  assert.deepStrictEqual(row.map(b => b.text), ['✅ TAKEN', '⏰ Snooze 10m', '⏭ SKIP']);
  assert.strictEqual(row[0].callback_data, `${CALLBACK_ACTIONS.TAKEN}:42:1700000000000`);
  assert.strictEqual(row[1].callback_data, `${CALLBACK_ACTIONS.SNOOZE}:42:1700000000000`);
  assert.strictEqual(row[2].callback_data, `${CALLBACK_ACTIONS.SKIP}:42:1700000000000`);
});

test('buildDoseKeyboard drops Snooze once the cap is reached', () => {
  const kb = buildDoseKeyboard(7, 123, MAX_SNOOZES);
  const row = kb.inline_keyboard[0];
  assert.strictEqual(row.length, 2);
  assert.deepStrictEqual(row.map(b => b.text), ['✅ TAKEN', '⏭ SKIP']);
});

test('buildDoseKeyboard defaults snoozeCount to 0 (Snooze shown)', () => {
  const row = buildDoseKeyboard(1, 2).inline_keyboard[0];
  assert.strictEqual(row.length, 3);
});

test('buildTakePromptMessage appends and HTML-escapes the dosage', () => {
  assert.strictEqual(
    buildTakePromptMessage('Aspirin', '100mg'),
    '💊 Time to take <b>Aspirin</b> (100mg)'
  );
  assert.strictEqual(
    buildTakePromptMessage('Aspirin', ''),
    '💊 Time to take <b>Aspirin</b>'
  );
  assert.strictEqual(
    buildTakePromptMessage('A & B', '<x>'),
    '💊 Time to take <b>A &amp; B</b> (&lt;x&gt;)'
  );
});
