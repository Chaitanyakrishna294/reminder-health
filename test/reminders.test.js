const test = require('node:test');
const assert = require('node:assert');
const { dosesPerDay, buildDoseKeyboard, buildTakePromptMessage, daysOfStockLeft, isLowStock, LOW_STOCK_DAYS } = require('../src/reminders');
const { CALLBACK_ACTIONS, MAX_SNOOZES } = require('../src/constants');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const lowStockFixture = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures', 'low-stock-cases.json'), 'utf8')
);

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

test('daysOfStockLeft: current_stock first, dosage_amount in burn rate, null = tracking off', () => {
  // 20 tablets, 2 per dose, twice daily → 5 days (not 10)
  assert.strictEqual(daysOfStockLeft({ current_stock: 20, dosage_amount: 2, frequency: 'twice_daily' }), 5);
  // falls back to tablet_count when current_stock is null (legacy rows)
  assert.strictEqual(daysOfStockLeft({ current_stock: null, tablet_count: 6, frequency: 'once_daily' }), 6);
  // missing/zero dosage_amount treated as 1
  assert.strictEqual(daysOfStockLeft({ current_stock: 9, frequency: 'thrice_daily' }), 3);
  assert.strictEqual(daysOfStockLeft({ current_stock: 9, dosage_amount: 0, frequency: 'thrice_daily' }), 3);
  // no stock recorded → null, never 0/LOW STOCK
  assert.strictEqual(daysOfStockLeft({ frequency: 'once_daily' }), null);
  assert.strictEqual(daysOfStockLeft({ current_stock: null, tablet_count: null, frequency: 'once_daily' }), null);
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

test('LOW_STOCK_DAYS is the documented 3-day backup window', () => {
  assert.strictEqual(LOW_STOCK_DAYS, 3);
});

// The same fixture is run through the web mirror in
// web/src/lib/medications/stock.test.ts. If these two ever disagree, one of
// the runs fails — which is the entire point of sharing the file.
test('isLowStock matches the shared fixture', () => {
  for (const c of lowStockFixture.cases) {
    const actual = isLowStock(c.med);
    assert.strictEqual(actual.low, c.expected.low, `low mismatch: ${c.name}`);
    assert.strictEqual(actual.reason, c.expected.reason, `reason mismatch: ${c.name}`);
  }
});

test('isLowStock reports the numbers the copy needs', () => {
  const r = isLowStock({
    active: true, low_stock_alert_enabled: true,
    current_stock: 4, stock_threshold: 4, frequency: 'once_daily', dosage_amount: 1,
  });
  assert.strictEqual(r.stock, 4);
  assert.strictEqual(r.threshold, 4);
  assert.strictEqual(r.daysLeft, 4);
});
