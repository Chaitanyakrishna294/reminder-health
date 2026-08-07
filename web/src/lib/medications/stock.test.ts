// Self-contained check for the web mirror of the bot's low-stock predicate. No framework:
//   node --experimental-strip-types src/lib/medications/stock.test.ts
// Fails loudly (non-zero exit) if any invariant breaks.
//
// The fixture is the SAME file the bot test reads (test/fixtures/low-stock-cases.json).
// That is deliberate: docs/WORK_LEDGER.md lists bot<->web mirror drift as a live
// landmine, and a shared fixture turns drift into a failing run instead of a
// reminder that silently stops firing.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isLowStock, LOW_STOCK_DAYS, type StockInput } from './stock.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, '..', '..', '..', '..', 'test', 'fixtures', 'low-stock-cases.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  cases: { name: string; med: StockInput; expected: { low: boolean; reason: string | null } }[];
};

assert.equal(LOW_STOCK_DAYS, 3);

for (const c of fixture.cases) {
  const actual = isLowStock(c.med);
  assert.equal(actual.low, c.expected.low, `low mismatch: ${c.name}`);
  assert.equal(actual.reason, c.expected.reason, `reason mismatch: ${c.name}`);
}

// Numbers the copy depends on.
const r = isLowStock({
  active: true, low_stock_alert_enabled: true,
  current_stock: 4, stock_threshold: 4, frequency: 'once_daily', dosage_amount: 1,
});
assert.equal(r.stock, 4);
assert.equal(r.threshold, 4);
assert.equal(r.daysLeft, 4);

console.log(`stock.test.ts: ${fixture.cases.length} shared cases OK`);
