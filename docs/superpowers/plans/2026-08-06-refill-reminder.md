# Refill Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `medications.stock_threshold` actually fire a refill reminder — via web push, the in-app bell, a dashboard warning strip and a full-screen refill gate — and collapse the three disagreeing definitions of "low stock" onto one.

**Architecture:** A pure `isLowStock(med)` predicate lives in `src/reminders.js` (bot) and is mirrored in `web/src/lib/medications/stock.ts` (web); a shared JSON fixture is run through both so the mirror cannot drift silently. The worker's existing 09:00 cron switches to that predicate and gains web push + a bell row, fired once per crossing and re-armed by a `BEFORE UPDATE` trigger on `medications` whenever stock increases. The web reads the predicate live, so the strip and gate are correct the moment the app opens even if the cron never ran.

**Tech Stack:** Node 22 CommonJS worker (`src/`, `node:test`), Next.js 16 App Router + React 19 + TS strict + Tailwind v4 (`web/`), Supabase Postgres with hand-applied SQL migrations (`db/migrations/`).

## Global Constraints

- **Migrations are applied manually by the maintainer.** Write the `.sql` file; never run it, never call `supabase db push`, never apply via MCP. Tasks that depend on a migration must still be committable before it is applied.
- **`src/utils.js` and `web/src/lib/medication-utils.ts` must keep identical moment-timezone DST math.** This plan does not touch either. Do not "helpfully" migrate anything to `Intl`.
- **Medication catalog links are human-select-only.** Not touched here; do not add auto-matching.
- **Dashboard nav = exactly 5 icons.** This plan adds no nav entries.
- **Colour and copy rules come from `docs/DESIGN_SYSTEM.md`.** Low stock is `warning` (orange), never `danger` (red — reserved for a missed dose). Text on a status tint uses `text-warning-strong` / `text-danger-strong`, never `text-*-foreground` (those are white and vanish on a tint). Solid buttons use `bg-primary-strong` / `bg-danger-strong`.
- **Priority label vocabulary:** Routine / Important / Critical, from `web/src/lib/design/semantics.ts`. Not touched here.
- **Every interactive control ≥ 44×44 px**, and every icon-only control needs a real `aria-label` (`title` alone is not announced on touch).
- **All new web components branch on `useUiMode().isElderly`**, following the pattern in `med-due-gate.tsx`.
- **Backup rule constant:** low if `stock <= stock_threshold` OR `daysOfStockLeft(med) <= 3`. The `3` is `LOW_STOCK_DAYS`, defined once in each mirror.
- **Exclusions:** a medication is never low when `active === false`, when `low_stock_alert_enabled` is falsy, or when stock is null.
- Run worker tests with `npm test` from the repo root. Run web typecheck with `./node_modules/.bin/tsc --noEmit` from `web/`.
- Branch is `feat/refill-reminder`, already created, spec already committed there.

---

### Task 1: Shared low-stock fixture and the bot-side predicate

**Files:**
- Create: `test/fixtures/low-stock-cases.json`
- Modify: `src/reminders.js` (add `LOW_STOCK_DAYS` + `isLowStock`, extend `module.exports` at line 81)
- Test: `test/reminders.test.js` (append)

**Interfaces:**
- Consumes: existing `daysOfStockLeft(med)` and `dosesPerDay(frequency)` from `src/reminders.js`.
- Produces:
  - `LOW_STOCK_DAYS: number` (= 3)
  - `isLowStock(med) -> { low: boolean, reason: 'threshold'|'days'|null, stock: number|null, daysLeft: number|null, threshold: number|null }`
  - `test/fixtures/low-stock-cases.json` — `{ cases: Array<{ name: string, med: object, expected: { low: boolean, reason: string|null } }> }`, consumed by Task 2's web test.

- [ ] **Step 1: Write the fixture**

Create `test/fixtures/low-stock-cases.json`:

```json
{
  "comment": "Read by BOTH test/reminders.test.js (bot) and web/src/lib/medications/stock.test.ts (web). If the two implementations of isLowStock ever disagree, one of those runs fails. Do not add a case to one test without adding it here.",
  "cases": [
    {
      "name": "tracking disabled -> never low",
      "med": { "active": true, "low_stock_alert_enabled": false, "current_stock": 1, "stock_threshold": 4, "frequency": "once_daily", "dosage_amount": 1 },
      "expected": { "low": false, "reason": null }
    },
    {
      "name": "no stock recorded -> never low",
      "med": { "active": true, "low_stock_alert_enabled": true, "current_stock": null, "tablet_count": null, "stock_threshold": 4, "frequency": "once_daily", "dosage_amount": 1 },
      "expected": { "low": false, "reason": null }
    },
    {
      "name": "paused medication -> never low",
      "med": { "active": false, "low_stock_alert_enabled": true, "current_stock": 1, "stock_threshold": 4, "frequency": "once_daily", "dosage_amount": 1 },
      "expected": { "low": false, "reason": null }
    },
    {
      "name": "stock exactly equals threshold -> low (inclusive)",
      "med": { "active": true, "low_stock_alert_enabled": true, "current_stock": 4, "stock_threshold": 4, "frequency": "once_daily", "dosage_amount": 1 },
      "expected": { "low": true, "reason": "threshold" }
    },
    {
      "name": "stock below threshold -> low",
      "med": { "active": true, "low_stock_alert_enabled": true, "current_stock": 2, "stock_threshold": 4, "frequency": "once_daily", "dosage_amount": 1 },
      "expected": { "low": true, "reason": "threshold" }
    },
    {
      "name": "stock zero -> low via threshold",
      "med": { "active": true, "low_stock_alert_enabled": true, "current_stock": 0, "stock_threshold": 4, "frequency": "once_daily", "dosage_amount": 1 },
      "expected": { "low": true, "reason": "threshold" }
    },
    {
      "name": "above threshold but 3 days left -> low via days backup",
      "med": { "active": true, "low_stock_alert_enabled": true, "current_stock": 3, "stock_threshold": 2, "frequency": "once_daily", "dosage_amount": 1 },
      "expected": { "low": true, "reason": "days" }
    },
    {
      "name": "above threshold and plenty of days -> not low",
      "med": { "active": true, "low_stock_alert_enabled": true, "current_stock": 30, "stock_threshold": 4, "frequency": "once_daily", "dosage_amount": 1 },
      "expected": { "low": false, "reason": null }
    },
    {
      "name": "null threshold falls through to days backup -> low",
      "med": { "active": true, "low_stock_alert_enabled": true, "current_stock": 2, "stock_threshold": null, "frequency": "once_daily", "dosage_amount": 1 },
      "expected": { "low": true, "reason": "days" }
    },
    {
      "name": "null threshold with plenty of stock -> not low",
      "med": { "active": true, "low_stock_alert_enabled": true, "current_stock": 20, "stock_threshold": null, "frequency": "once_daily", "dosage_amount": 1 },
      "expected": { "low": false, "reason": null }
    },
    {
      "name": "threshold zero, one left -> days backup catches it",
      "med": { "active": true, "low_stock_alert_enabled": true, "current_stock": 1, "stock_threshold": 0, "frequency": "once_daily", "dosage_amount": 1 },
      "expected": { "low": true, "reason": "days" }
    },
    {
      "name": "threshold zero, empty -> low via threshold",
      "med": { "active": true, "low_stock_alert_enabled": true, "current_stock": 0, "stock_threshold": 0, "frequency": "once_daily", "dosage_amount": 1 },
      "expected": { "low": true, "reason": "threshold" }
    },
    {
      "name": "burn rate includes dosage_amount: 2 tablets twice daily = 4/day",
      "med": { "active": true, "low_stock_alert_enabled": true, "current_stock": 10, "stock_threshold": 2, "frequency": "twice_daily", "dosage_amount": 2 },
      "expected": { "low": true, "reason": "days" }
    },
    {
      "name": "tablet_count is used when current_stock is null",
      "med": { "active": true, "low_stock_alert_enabled": true, "current_stock": null, "tablet_count": 3, "stock_threshold": 4, "frequency": "once_daily", "dosage_amount": 1 },
      "expected": { "low": true, "reason": "threshold" }
    },
    {
      "name": "active undefined (column not selected) is treated as active",
      "med": { "low_stock_alert_enabled": true, "current_stock": 1, "stock_threshold": 4, "frequency": "once_daily", "dosage_amount": 1 },
      "expected": { "low": true, "reason": "threshold" }
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

In `test/reminders.test.js`, first extend the existing destructured require on **line 3**
(do not add a second `require('../src/reminders')`):

```js
const { dosesPerDay, buildDoseKeyboard, buildTakePromptMessage, daysOfStockLeft, isLowStock, LOW_STOCK_DAYS } = require('../src/reminders');
```

Add these two requires and the fixture load directly beneath it, with the other top-of-file requires:

```js
const { readFileSync } = require('node:fs');
const path = require('node:path');

const lowStockFixture = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures', 'low-stock-cases.json'), 'utf8')
);
```

Then append the tests to the end of the file:

```js
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `isLowStock is not a function` (it is not exported yet).

- [ ] **Step 4: Implement `isLowStock`**

In `src/reminders.js`, add after `daysOfStockLeft` (currently ending at line 79):

```js
/** Days of remaining stock at or below which a medication counts as low, when no
 *  usable stock_threshold is set — and as a backup when the threshold is so small
 *  it would give almost no warning (threshold 2 on a 4-doses-a-day med is half a day). */
const LOW_STOCK_DAYS = 3;

/**
 * The single definition of "this medication needs refilling".
 *
 * Before this existed there were three: the 09:00 cron used `daysOfStockLeft <= 3`,
 * the web dashboard re-typed the same math inline, and the medication card badge used
 * `current_stock <= stock_threshold` — so the threshold the user set in the wizard,
 * under the promise "You will receive an alert when stock reaches this amount",
 * drove one badge and no alert at all.
 *
 * Mirrored in web/src/lib/medications/stock.ts; both are run against
 * test/fixtures/low-stock-cases.json so they cannot drift apart silently.
 *
 * `reason` exists so copy can be honest: "4 left, you asked to be warned at 4" and
 * "about 2 days left" are different sentences and one generic string is wrong half
 * the time.
 *
 * @param {{active?: boolean, low_stock_alert_enabled?: boolean, current_stock?: number|null,
 *          tablet_count?: number|null, stock_threshold?: number|null, frequency: string,
 *          dosage_amount?: number|null}} med
 * @returns {{low: boolean, reason: 'threshold'|'days'|null, stock: number|null,
 *            daysLeft: number|null, threshold: number|null}}
 */
const isLowStock = (med) => {
  const threshold = med.stock_threshold ?? null;
  const stock = med.current_stock ?? med.tablet_count ?? null;
  const idle = { low: false, reason: null, stock, daysLeft: null, threshold };

  // `active` is undefined when the caller did not select the column; every such
  // caller has already filtered to active rows, so absent means active.
  if (med.active === false) return idle;
  if (!med.low_stock_alert_enabled) return idle;
  if (stock === null || stock === undefined) return idle;

  const daysLeft = daysOfStockLeft(med);
  const base = { ...idle, daysLeft };

  if (threshold !== null && threshold !== undefined && Number(stock) <= Number(threshold)) {
    return { ...base, low: true, reason: 'threshold' };
  }
  if (daysLeft !== null && daysLeft <= LOW_STOCK_DAYS) {
    return { ...base, low: true, reason: 'days' };
  }
  return base;
};
```

Then extend the export block at the bottom of the file:

```js
module.exports = {
  dosesPerDay,
  buildDoseKeyboard,
  buildTakePromptMessage,
  daysOfStockLeft,
  LOW_STOCK_DAYS,
  isLowStock,
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all previous tests plus the three new ones. Total count rises from 16 to 19.

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/low-stock-cases.json src/reminders.js test/reminders.test.js
git commit -m "feat(stock): add isLowStock, the single definition of low stock

The threshold the user sets in the wizard has never fired an alert: the cron
and the dashboard both used a hardcoded 3-day heuristic and only the card
badge read the column. isLowStock makes threshold primary with the 3-day rule
as a backup, and reports which one fired so the copy can be honest.

The fixture is shared with the web mirror so the two cannot drift.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Web mirror of the predicate

**Files:**
- Create: `web/src/lib/medications/stock.ts`
- Test: `web/src/lib/medications/stock.test.ts`

**Interfaces:**
- Consumes: `test/fixtures/low-stock-cases.json` from Task 1.
- Produces:
  - `LOW_STOCK_DAYS: number`
  - `type LowStockReason = 'threshold' | 'days'`
  - `interface StockStatus { low: boolean; reason: LowStockReason | null; stock: number | null; daysLeft: number | null; threshold: number | null }`
  - `interface StockInput { active?: boolean | null; low_stock_alert_enabled?: boolean | null; current_stock?: number | null; tablet_count?: number | null; stock_threshold?: number | null; frequency?: string | null; dosage_amount?: number | null }`
  - `dosesPerDay(frequency?: string | null): number`
  - `daysOfStockLeft(med: StockInput): number | null`
  - `isLowStock(med: StockInput): StockStatus`
  - `interface LowStockMed { id: number; drug_name: string; unit_type: string | null; stock: number; threshold: number | null; daysLeft: number | null; reason: LowStockReason }` — the serialisable row the server page passes to the strip and gate (Tasks 6 and 7).

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/medications/stock.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `web/`: `node --experimental-strip-types src/lib/medications/stock.test.ts`
Expected: FAIL — `Cannot find module './stock.ts'`.

- [ ] **Step 3: Implement the mirror**

Create `web/src/lib/medications/stock.ts`:

```ts
// Web mirror of the bot's low-stock predicate (src/reminders.js).
//
// Kept in lockstep by test/fixtures/low-stock-cases.json, which both this file's
// test and test/reminders.test.js run through. If you change the rule here, change
// it there, and add the case to the fixture — otherwise one surface will warn a
// patient and the other will stay silent.
//
// See docs/superpowers/specs/2026-08-06-refill-reminder-design.md.

export const LOW_STOCK_DAYS = 3;

export type LowStockReason = 'threshold' | 'days';

export interface StockInput {
  active?: boolean | null;
  low_stock_alert_enabled?: boolean | null;
  current_stock?: number | null;
  tablet_count?: number | null;
  stock_threshold?: number | null;
  frequency?: string | null;
  dosage_amount?: number | null;
}

export interface StockStatus {
  low: boolean;
  reason: LowStockReason | null;
  stock: number | null;
  daysLeft: number | null;
  threshold: number | null;
}

/** Serialisable row handed from the dashboard server component to the strip and gate. */
export interface LowStockMed {
  id: number;
  drug_name: string;
  unit_type: string | null;
  stock: number;
  threshold: number | null;
  daysLeft: number | null;
  reason: LowStockReason;
}

export function dosesPerDay(frequency?: string | null): number {
  switch (frequency) {
    case 'twice_daily': return 2;
    case 'thrice_daily': return 3;
    default: return 1;
  }
}

/** Days of stock left, or null when stock tracking is off. Burn rate includes
 *  dosage_amount — 2 tablets twice a day burns 4/day, not 2. */
export function daysOfStockLeft(med: StockInput): number | null {
  const stock = med.current_stock ?? med.tablet_count ?? null;
  if (stock === null || stock === undefined) return null;
  const perDay = dosesPerDay(med.frequency) * (Number(med.dosage_amount) || 1);
  return Math.floor(Number(stock) / perDay);
}

export function isLowStock(med: StockInput): StockStatus {
  const threshold = med.stock_threshold ?? null;
  const stock = med.current_stock ?? med.tablet_count ?? null;
  const idle: StockStatus = { low: false, reason: null, stock, daysLeft: null, threshold };

  // `active` is undefined when the caller did not select the column; every such
  // caller has already filtered to active rows, so absent means active.
  if (med.active === false) return idle;
  if (!med.low_stock_alert_enabled) return idle;
  if (stock === null || stock === undefined) return idle;

  const daysLeft = daysOfStockLeft(med);
  const base: StockStatus = { ...idle, daysLeft };

  if (threshold !== null && threshold !== undefined && Number(stock) <= Number(threshold)) {
    return { ...base, low: true, reason: 'threshold' };
  }
  if (daysLeft !== null && daysLeft <= LOW_STOCK_DAYS) {
    return { ...base, low: true, reason: 'days' };
  }
  return base;
}

/** One honest sentence about why this medication is low. */
export function lowStockReasonText(med: LowStockMed, unitLabel: string): string {
  if (med.stock === 0) return `None left`;
  if (med.reason === 'threshold' && med.threshold !== null) {
    return `${med.stock} ${unitLabel} left — you asked to be warned at ${med.threshold}`;
  }
  const d = med.daysLeft ?? 0;
  return `${med.stock} ${unitLabel} left — about ${d} ${d === 1 ? 'day' : 'days'}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `web/`: `node --experimental-strip-types src/lib/medications/stock.test.ts`
Expected: PASS, printing `stock.test.ts: 15 shared cases OK`.

Then run from `web/`: `./node_modules/.bin/tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/medications/stock.ts web/src/lib/medications/stock.test.ts
git commit -m "feat(stock): mirror isLowStock on the web, pinned by the shared fixture

Both implementations now run the same JSON cases, so mirror drift fails a test
run instead of silently making one surface warn and the other stay quiet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Migration — suppression column, notification type, re-arm trigger

**Files:**
- Create: `db/migrations/migration_refill_reminder.sql`
- Create: `db/rollbacks/rollback_refill_reminder.sql`
- Create: `db/validations/validation_refill_reminder.sql`
- Modify: `db/migrations/APPLIED.md`

**Interfaces:**
- Produces: `medications.low_stock_notified_at timestamptz` (consumed by Task 4), the `'LOW_STOCK'` value in `notifications_type_check` (consumed by Task 4 and Task 8), and the `rearm_low_stock_notice()` trigger.

**DO NOT APPLY THIS MIGRATION.** Write the files and stop. The maintainer pastes them into the Supabase SQL editor. Tasks 4–8 are written so they can be committed before it is applied.

- [ ] **Step 1: Write the migration**

Create `db/migrations/migration_refill_reminder.sql`:

```sql
-- ============================================================================
-- Refill reminder: threshold-based low-stock alerting
-- Spec: docs/superpowers/specs/2026-08-06-refill-reminder-design.md
--
-- 1. medications.low_stock_notified_at  — one alert per crossing, not one a day
-- 2. notifications 'LOW_STOCK' type     — the in-app bell row
-- 3. rearm_low_stock_notice()           — clears the flag when stock goes back up
-- Idempotent; safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Suppression flag
-- Threshold alerts fire far earlier than the old 3-day rule, so without this a
-- threshold of 10 on a once-daily medication would be 10 consecutive identical
-- pushes — and people who are nagged stop reading.
-- ----------------------------------------------------------------------------
ALTER TABLE public.medications
  ADD COLUMN IF NOT EXISTS low_stock_notified_at timestamptz;

COMMENT ON COLUMN public.medications.low_stock_notified_at IS
  'Set by the 09:00 low-stock cron when a refill alert is sent. Cleared by '
  'rearm_low_stock_notice() on any stock increase. NULL means "eligible to alert".';

-- ----------------------------------------------------------------------------
-- 2. In-app notification type
-- Full list carried forward from migration_5.7b_escalation_outcomes_ddl.sql
-- (applied 2026-06-13, entry 27 in APPLIED.md) plus LOW_STOCK.
-- ----------------------------------------------------------------------------
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
CHECK (type IN (
  'TAKEN', 'SKIPPED', 'MISSED', 'ESCALATED',
  'CARE_CIRCLE_ACCESS_REQUEST',
  'CARE_CIRCLE_ACCESS_GRANTED',
  'CARE_CIRCLE_ACCESS_UPDATED',
  'CARE_CIRCLE_ACCESS_REVOKED',
  'CARE_CIRCLE_PRIMARY_CHANGED',
  'UNCONFIRMED',
  'LOW_STOCK'
));

-- ----------------------------------------------------------------------------
-- 3. Re-arm on restock
--
-- Deliberately "stock increased", NOT "crossed back above stock_threshold". An
-- alert raised by the 3-days-left backup has no threshold to cross back over, and
-- expressing that condition here would mean duplicating the dosesPerDay burn-rate
-- math in SQL, where it cannot be unit-tested. "You bought more, so you are
-- eligible to be warned again next time you get low" is also simply correct:
-- someone who tops up by one tablet and is still low SHOULD hear again tomorrow.
--
-- BEFORE UPDATE (not AFTER) so it mutates NEW in place — an AFTER trigger issuing
-- its own UPDATE on medications would recurse.
--
-- Note this does not fire when the cron stamps low_stock_notified_at, because that
-- write does not change current_stock.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rearm_low_stock_notice()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.current_stock IS NOT NULL
     AND OLD.current_stock IS NOT NULL
     AND NEW.current_stock > OLD.current_stock THEN
    NEW.low_stock_notified_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_rearm_low_stock_notice ON public.medications;
CREATE TRIGGER trigger_rearm_low_stock_notice
  BEFORE UPDATE ON public.medications
  FOR EACH ROW
  EXECUTE FUNCTION public.rearm_low_stock_notice();
```

- [ ] **Step 2: Write the rollback**

Create `db/rollbacks/rollback_refill_reminder.sql`:

```sql
-- Rollback for migration_refill_reminder.sql.
-- Run the DELETE before restoring the constraint, or the constraint will fail
-- validation against any LOW_STOCK rows already written.

DROP TRIGGER IF EXISTS trigger_rearm_low_stock_notice ON public.medications;
DROP FUNCTION IF EXISTS public.rearm_low_stock_notice();

DELETE FROM public.notifications WHERE type = 'LOW_STOCK';

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
CHECK (type IN (
  'TAKEN', 'SKIPPED', 'MISSED', 'ESCALATED',
  'CARE_CIRCLE_ACCESS_REQUEST',
  'CARE_CIRCLE_ACCESS_GRANTED',
  'CARE_CIRCLE_ACCESS_UPDATED',
  'CARE_CIRCLE_ACCESS_REVOKED',
  'CARE_CIRCLE_PRIMARY_CHANGED',
  'UNCONFIRMED'
));

ALTER TABLE public.medications DROP COLUMN IF EXISTS low_stock_notified_at;
```

- [ ] **Step 3: Write the validation**

Create `db/validations/validation_refill_reminder.sql`:

```sql
-- Paste after migration_refill_reminder.sql. Every row must report PASS.

SELECT 'column exists' AS check,
       CASE WHEN EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='medications'
           AND column_name='low_stock_notified_at'
       ) THEN 'PASS' ELSE 'FAIL' END AS result;

SELECT 'LOW_STOCK accepted by constraint' AS check,
       CASE WHEN pg_get_constraintdef(oid) LIKE '%LOW_STOCK%'
            THEN 'PASS' ELSE 'FAIL' END AS result
FROM pg_constraint WHERE conname = 'notifications_type_check';

SELECT 'pre-existing types still accepted' AS check,
       CASE WHEN pg_get_constraintdef(oid) LIKE '%CARE_CIRCLE_PRIMARY_CHANGED%'
             AND pg_get_constraintdef(oid) LIKE '%UNCONFIRMED%'
            THEN 'PASS' ELSE 'FAIL' END AS result
FROM pg_constraint WHERE conname = 'notifications_type_check';

SELECT 'rearm trigger installed' AS check,
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_trigger
         WHERE tgname = 'trigger_rearm_low_stock_notice' AND NOT tgisinternal
       ) THEN 'PASS' ELSE 'FAIL' END AS result;

-- Behavioural: stamping the flag must NOT clear it; raising stock MUST.
DO $$
DECLARE v_id bigint; v_stock numeric; v_flag timestamptz;
BEGIN
  SELECT id, current_stock INTO v_id, v_stock
  FROM public.medications WHERE current_stock IS NOT NULL LIMIT 1;
  IF v_id IS NULL THEN
    RAISE NOTICE 'SKIP behavioural check: no medication with stock tracking';
    RETURN;
  END IF;

  UPDATE public.medications SET low_stock_notified_at = now() WHERE id = v_id;
  SELECT low_stock_notified_at INTO v_flag FROM public.medications WHERE id = v_id;
  IF v_flag IS NULL THEN RAISE EXCEPTION 'FAIL: flag cleared without a stock increase'; END IF;

  UPDATE public.medications SET current_stock = v_stock + 1 WHERE id = v_id;
  SELECT low_stock_notified_at INTO v_flag FROM public.medications WHERE id = v_id;
  IF v_flag IS NOT NULL THEN RAISE EXCEPTION 'FAIL: flag survived a stock increase'; END IF;

  -- restore
  UPDATE public.medications SET current_stock = v_stock WHERE id = v_id;
  RAISE NOTICE 'PASS behavioural re-arm check';
END $$;
```

- [ ] **Step 4: Record it in the ledger as pending**

In `db/migrations/APPLIED.md`, add a row to the order table with the next free number and the date left as `pending`:

```markdown
| 37 | `migration_refill_reminder.sql` | pending — refill reminder: low_stock_notified_at, LOW_STOCK type, rearm trigger |
```

Add to the current-function map table in the same file:

```markdown
| `rearm_low_stock_notice` | `migration_refill_reminder.sql` |
```

- [ ] **Step 5: Commit**

```bash
git add db/migrations/migration_refill_reminder.sql db/rollbacks/rollback_refill_reminder.sql db/validations/validation_refill_reminder.sql db/migrations/APPLIED.md
git commit -m "feat(db): migration for refill reminders (NOT APPLIED)

low_stock_notified_at for once-per-crossing alerting, LOW_STOCK notification
type, and a BEFORE UPDATE trigger that re-arms the flag on any stock increase.

Re-arm is on 'stock increased' rather than 'crossed back above threshold'
because an alert raised by the days-left backup has no threshold to cross, and
encoding that would duplicate the burn-rate math in untestable SQL.

Maintainer applies by hand; APPLIED.md row is marked pending.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Cron sends push + bell, once per crossing

**Files:**
- Modify: `src/scheduler.js:688-735` (the "3. Daily Low Stock Alert" cron block), and the `require` on line 9

**Interfaces:**
- Consumes: `isLowStock` from Task 1; `low_stock_notified_at` and `'LOW_STOCK'` from Task 3; the existing `sendBrowserPush(telegramId, { title, body })` at `src/scheduler.js:32`.
- Produces: no new exports. Behaviour: one Telegram + one push + one bell row per crossing, then `low_stock_notified_at` stamped.

**This task's runtime behaviour depends on Task 3 being applied.** Until then, the `low_stock_notified_at` update fails and is caught — see Step 3. Commit anyway.

- [ ] **Step 1: Extend the require**

`src/scheduler.js` line 9 currently reads:

```js
const { buildDoseKeyboard, buildTakePromptMessage, daysOfStockLeft } = require('./reminders');
```

Change to:

```js
const { buildDoseKeyboard, buildTakePromptMessage, daysOfStockLeft, isLowStock } = require('./reminders');
```

- [ ] **Step 2: Replace the cron body**

Replace the whole block from `// 3. Daily Low Stock Alert` (line 687) through its closing `});` (line 735) with:

```js
  // 3. Daily Refill Reminder - Every day at 9:00 AM Asia/Kolkata
  //
  // Fires on isLowStock(): stock <= stock_threshold (the value the user actually set
  // in the wizard, which before this drove no alert at all), with daysOfStockLeft <= 3
  // as a backup. Sends once per crossing — low_stock_notified_at is stamped here and
  // cleared by the rearm_low_stock_notice() DB trigger on any restock, so a generous
  // threshold does not become a daily nag.
  //
  // Three channels: Telegram (as before), web push, and an in-app bell row. Push and
  // the bell matter most for web-only accounts (synthetic WEB-* ids), which bot
  // .sendMessage() no-ops for — those users previously got no refill warning at all.
  cron.schedule('0 9 * * *', async () => {
    try {
      console.log('📦 Checking for low stock medications...');

      const { data: activeMeds, error } = await supabase
        .from('medications')
        .select('*')
        .eq('active', true)
        .eq('low_stock_alert_enabled', true)
        .is('low_stock_notified_at', null);

      if (error) {
        console.error('Error fetching medications for low stock check:', error);
        return;
      }

      if (!activeMeds || activeMeds.length === 0) return;

      for (const med of activeMeds) {
        const status = isLowStock(med);
        if (!status.low) continue;

        const unit = (med.unit_type || 'unit').toLowerCase();
        const reasonLine = status.reason === 'threshold'
          ? `You asked to be warned at ${status.threshold}.`
          : `About ${status.daysLeft} day${status.daysLeft === 1 ? '' : 's'} left.`;
        const headline = status.stock === 0
          ? `You have run out of ${med.drug_name}.`
          : `Your stock of ${med.drug_name} is running low.`;

        const message =
          `⚠️ ${escapeHTML(headline)}\n\n` +
          `${status.stock} ${escapeHTML(unit)}${status.stock === 1 ? '' : 's'} remaining. ${escapeHTML(reasonLine)}\n\n` +
          `Please refill soon.`;

        const inlineKeyboard = {
          inline_keyboard: [
            [
              { text: '✅ Bought', callback_data: `${CALLBACK_ACTIONS.REFILL_BOUGHT}:${med.id}` },
              { text: '❌ Stop Reminders', callback_data: `${CALLBACK_ACTIONS.REFILL_STOP}:${med.id}` }
            ]
          ]
        };

        // Each channel swallows its own failure: a dead Telegram chat must not stop
        // the push, and neither must stop the row that puts this in the bell feed.
        try {
          await bot.sendMessage(med.telegram_id, message, { parse_mode: 'HTML', reply_markup: inlineKeyboard });
        } catch (err) {
          console.error(`Low stock Telegram send failed for med ${med.id}:`, err.message);
        }

        try {
          await sendBrowserPush(med.telegram_id, {
            title: status.stock === 0 ? `Out of ${med.drug_name}` : `${med.drug_name} is running low`,
            body: `${status.stock} ${unit}${status.stock === 1 ? '' : 's'} left. ${reasonLine}`,
          });
        } catch (err) {
          console.error(`Low stock push failed for med ${med.id}:`, err.message);
        }

        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('telegram_chat_id', med.telegram_id)
            .maybeSingle();

          if (profile) {
            await supabase.from('notifications').insert([{
              user_id: profile.id,
              title: status.stock === 0 ? `Out of ${med.drug_name}` : `${med.drug_name} is running low`,
              message: `${status.stock} ${unit}${status.stock === 1 ? '' : 's'} left. ${reasonLine}`,
              type: 'LOW_STOCK',
            }]);
          }
        } catch (err) {
          console.error(`Low stock bell row failed for med ${med.id}:`, err.message);
        }

        // Stamp last: if this fails the user gets a duplicate tomorrow, which is a
        // far better failure than never hearing at all.
        try {
          await supabase
            .from('medications')
            .update({ low_stock_notified_at: new Date().toISOString() })
            .eq('id', med.id);
        } catch (err) {
          console.error(`Low stock stamp failed for med ${med.id}:`, err.message);
        }

        await delay(200);
      }
    } catch (err) {
      console.error('Low stock alert error:', err);
    }
  }, {
    timezone: "Asia/Kolkata"
  });
```

- [ ] **Step 3: Verify the worker still starts and tests pass**

Run: `npm test`
Expected: PASS, 19 tests (this task adds none; it must not break the existing ones).

Run: `node -e "require('./src/scheduler.js'); console.log('scheduler loads')"`
Expected: prints `scheduler loads` with no syntax error.

Note: `.is('low_stock_notified_at', null)` will error at runtime until Task 3's migration is applied; the outer `try/catch` logs it and returns, so the worker keeps running and every other cron is unaffected.

- [ ] **Step 4: Commit**

```bash
git add src/scheduler.js
git commit -m "feat(scheduler): refill reminder fires on the user's threshold

The 09:00 cron now uses isLowStock (threshold first, 3-days-left as backup)
instead of the hardcoded 3-day rule, and sends web push and an in-app bell row
alongside Telegram. Web-only accounts (WEB-* ids) previously received no refill
warning at all, since bot.sendMessage no-ops for them.

Alerts once per crossing via low_stock_notified_at; each channel swallows its
own failure so one dead channel cannot silence the others.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: One shared stock-write path

**Files:**
- Create: `web/src/lib/medications/add-stock.ts`
- Modify: `web/src/components/dashboard/dashboard-client-view.tsx` (`submitRefill`, ~line 541)
- Modify: `web/src/components/medications/medication-list.tsx` (`confirmAddStock`, ~line 98)

**Interfaces:**
- Consumes: the Supabase browser client from `@/lib/supabase/client`.
- Produces: `addStock({ supabase, medicationId, currentStock, amount }): Promise<{ newStock: number }>` — throws `Error` with a user-safe message. Used by Tasks 6 and 7 too.

- [ ] **Step 1: Create the shared writer**

Create `web/src/lib/medications/add-stock.ts`:

```ts
// The single way the web adds stock to a medication.
//
// Two implementations of this already existed — submitRefill in the dashboard
// inventory card and confirmAddStock in the medication list — and the refill gate
// would have been a third. That is exactly how this codebase ended up with three
// disagreeing definitions of "low stock"; one writer prevents the repeat.
//
// current_stock is the source of truth; a DB trigger keeps tablet_count as a
// floored mirror. Raising current_stock also clears low_stock_notified_at via the
// rearm_low_stock_notice() trigger, which is what makes the next crossing alertable.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface AddStockArgs {
  supabase: SupabaseClient;
  medicationId: number;
  /** Current value; null/undefined is treated as 0. */
  currentStock: number | null | undefined;
  /** Units to ADD, not the new total. Must be > 0. */
  amount: number;
}

export async function addStock({
  supabase,
  medicationId,
  currentStock,
  amount,
}: AddStockArgs): Promise<{ newStock: number }> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Enter how many units you added.');
  }

  const newStock = Number(currentStock || 0) + amount;

  const { error } = await supabase
    .from('medications')
    .update({ current_stock: newStock })
    .eq('id', medicationId);

  if (error) {
    // RLS denial is the realistic failure for a caregiver without
    // can_edit_medications — say what it means rather than leaking the code.
    console.error('[addStock] update failed:', error.message);
    throw new Error("Could not update stock. You may not have permission to edit this patient's medications.");
  }

  return { newStock };
}
```

- [ ] **Step 2: Repoint the dashboard card**

In `web/src/components/dashboard/dashboard-client-view.tsx`, replace the body of `submitRefill` (currently lines 541-562) with:

```tsx
  const submitRefill = async (medId: number, currentStock: number | null | undefined) => {
    const amount = Number(refillAmount);
    setRefillBusyId(medId);
    try {
      const { newStock } = await addStock({ supabase, medicationId: medId, currentStock, amount });
      showToast('Stock updated', `Added ${amount}. Now ${newStock}.`, 'success');
      setRefillOpenId(null);
      setRefillAmount('');
      router.refresh();
    } catch (err) {
      showToast('Could not update stock', err instanceof Error ? err.message : 'Please try again.', 'error');
    } finally {
      setRefillBusyId(null);
    }
  };
```

Add the import alongside the other `@/lib` imports at the top of the file:

```tsx
import { addStock } from '@/lib/medications/add-stock';
```

- [ ] **Step 3: Repoint the medication list**

In `web/src/components/medications/medication-list.tsx`, replace the body of `confirmAddStock` (from line 98 through its `finally` block) with:

Keep the existing optimistic `setMeds` update — it is why this list updates without a
round trip, and `addStock` returns `newStock` precisely so it survives the extraction:

```tsx
  const confirmAddStock = async () => {
    if (!stockModalMed) return;
    const med = stockModalMed;
    const amount = Number(stockInput);
    setStockBusyId(med.id);
    setStockError('');
    try {
      const { newStock } = await addStock({
        supabase, medicationId: med.id, currentStock: med.current_stock, amount,
      });
      setMeds(prev => prev.map(m => (m.id === med.id ? { ...m, current_stock: newStock } : m)));
      setStockModalMed(null);
      setStockInput('');
    } catch (err) {
      setStockError(err instanceof Error ? err.message : 'Could not update stock.');
    } finally {
      setStockBusyId(null);
    }
  };
```

Note the positive-number guard is gone from here on purpose: `addStock` throws
`'Enter how many units you added.'` for a non-positive amount, and that message lands in
`setStockError` exactly where the old inline check put its own.

Add the import alongside the other `@/lib` imports:

```tsx
import { addStock } from '@/lib/medications/add-stock';
```

- [ ] **Step 4: Typecheck**

Run from `web/`: `./node_modules/.bin/tsc --noEmit`
Expected: no output.

Run from `web/`: `npx eslint src/components/medications/medication-list.tsx src/components/dashboard/dashboard-client-view.tsx`
Expected: no *new* `no-unused-vars` warnings versus before this task. Both files keep every
state setter they had — `setMeds`, `setStockError`, `setStockBusyId`, `showToast`,
`setRefillOpenId`, `setRefillAmount`, `setRefillBusyId` are all still used above.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/medications/add-stock.ts web/src/components/dashboard/dashboard-client-view.tsx web/src/components/medications/medication-list.tsx
git commit -m "refactor(stock): single add-stock write path

The dashboard card and the medication list each had their own copy and the
refill gate would have been a third. One writer, with an error message that
explains an RLS denial instead of leaking it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Dashboard computes low stock from the predicate, and shows the strip

**Files:**
- Create: `web/src/components/dashboard/refill-strip.tsx`
- Modify: `web/src/app/(dashboard)/dashboard/page.tsx:45-50` (select) and `:98-111` (lowStockMedicines)
- Modify: `web/src/components/dashboard/dashboard-client-view.tsx` (props + mount)
- Modify: `web/src/components/medications/medication-list.tsx:282-286` (badge predicate)

**Interfaces:**
- Consumes: `isLowStock`, `LowStockMed`, `lowStockReasonText` from Task 2; `addStock` from Task 5; `unitPhrase` from `@/components/medications/medication-form-options`.
- Produces: `<RefillStrip meds={LowStockMed[]} canEdit={boolean} />`; the `lowStockMedicines: LowStockMed[]` and `canEditStock: boolean` props on `DashboardClientView`.

- [ ] **Step 1: Widen the dashboard query**

In `web/src/app/(dashboard)/dashboard/page.tsx`, the medications select (line 48) currently omits `stock_threshold`. Replace that `.select(...)` string with:

```ts
      .select('id, drug_name, dosage, frequency, tablet_count, current_stock, stock_threshold, low_stock_alert_enabled, active, reminder_times, priority_level, unit_type, dosage_amount, medication_reason, timezone')
```

- [ ] **Step 2: Replace the inline low-stock math**

Replace lines 97-111 (the `// Active alerts (Low stock)` block) with:

```ts
  // Low stock — one shared definition (web/src/lib/medications/stock.ts), mirrored in
  // the bot. This used to re-type a 3-day heuristic inline and never read
  // stock_threshold at all, so the value the user set in the wizard did nothing.
  const lowStockMedicines: LowStockMed[] = (medications || [])
    .map((m) => ({ med: m, status: isLowStock(m) }))
    .filter(({ status }) => status.low)
    .map(({ med, status }) => ({
      id: med.id,
      drug_name: med.drug_name,
      unit_type: med.unit_type ?? null,
      stock: Number(status.stock),
      threshold: status.threshold,
      daysLeft: status.daysLeft,
      reason: status.reason as 'threshold' | 'days',
    }));

  const lowStockCount = lowStockMedicines.length;

  // Adding stock is a medication write. A caregiver in monitor mode only has it with
  // can_edit_medications; without it the gate must say so rather than offer an input
  // that dies on RLS.
  let canEditStock = true;
  if (targetChatId && myTelegramChatId && targetChatId !== myTelegramChatId) {
    const { data: link } = await supabase
      .from('active_caregiver_links')
      .select('can_edit_medications')
      .eq('caregiver_chat_id', myTelegramChatId)
      .eq('patient_telegram_id', targetChatId)
      .eq('is_active', true)
      .maybeSingle();
    canEditStock = !!link?.can_edit_medications;
  }
```

Add to the imports at the top of the file:

```ts
import { isLowStock, type LowStockMed } from '@/lib/medications/stock';
```

Then pass the new prop in the `<DashboardClientView ... />` call (the existing `lowStockMedicines={lowStockMedicines}` line stays as-is):

```tsx
      canEditStock={canEditStock}
```

- [ ] **Step 3: Build the strip**

Create `web/src/components/dashboard/refill-strip.tsx`:

```tsx
'use client';

// Pinned near the top of the dashboard whenever a medication needs refilling.
//
// Modelled on MissedDoseStrip and deliberately NOT dismissible: "Remind me tomorrow"
// on the gate defers the interruption, not the fact. Running low is still true
// tomorrow, and a dashboard that shows a medication as fine when it is not is worse
// than a strip someone has learned to live with.
//
// Ranked BELOW MissedDoseStrip when both are present — a missed dose outranks a refill.
// Tone is `warning`, not `danger`: per docs/DESIGN_SYSTEM.md orange is the actionable
// warning and red is reserved for a missed dose.

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import { addStock } from '@/lib/medications/add-stock';
import { lowStockReasonText, type LowStockMed } from '@/lib/medications/stock';
import { unitPhrase } from '@/components/medications/medication-form-options';
import { PackagePlus, AlertTriangle } from 'lucide-react';

interface RefillStripProps {
  meds: LowStockMed[];
  /** False for a caregiver without can_edit_medications — show the facts, no input. */
  canEdit: boolean;
}

export default function RefillStrip({ meds, canEdit }: RefillStripProps) {
  const supabase = createClient();
  const router = useRouter();
  const { isElderly } = useUiMode();
  const [openId, setOpenId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (meds.length === 0) return null;

  const submit = async (med: LowStockMed) => {
    setBusyId(med.id);
    setError(null);
    try {
      await addStock({ supabase, medicationId: med.id, currentStock: med.stock, amount: Number(amount) });
      setOpenId(null);
      setAmount('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update stock.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section
      aria-label="Medications needing a refill"
      className={`bg-warning/10 border border-warning/30 rounded-3xl ${isElderly ? 'p-6 space-y-4' : 'p-4 space-y-3'}`}
    >
      <h2 className={`flex items-center gap-2 font-black text-warning-strong ${isElderly ? 'text-xl' : 'text-sm'}`}>
        <AlertTriangle className={isElderly ? 'w-6 h-6' : 'w-4 h-4'} aria-hidden="true" />
        {meds.length === 1 ? '1 medication needs a refill' : `${meds.length} medications need a refill`}
      </h2>

      {error && (
        <p className="text-xs font-semibold text-danger-strong bg-danger/10 border border-danger/25 rounded-xl px-3 py-2">
          {error}
        </p>
      )}

      <ul className="space-y-2">
        {meds.map((med) => {
          const unit = unitPhrase(med.unit_type ?? undefined, med.stock);
          return (
            <li key={med.id} className="bg-card border border-border rounded-2xl px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={`font-black text-foreground truncate ${isElderly ? 'text-lg' : 'text-sm'}`}>
                    {med.drug_name}
                  </p>
                  <p className={`text-muted-foreground ${isElderly ? 'text-base' : 'text-xs'}`}>
                    {lowStockReasonText(med, unit)}
                  </p>
                </div>

                {canEdit && (
                  <button
                    onClick={() => { setOpenId(openId === med.id ? null : med.id); setAmount(''); setError(null); }}
                    aria-expanded={openId === med.id}
                    aria-label={`Add stock for ${med.drug_name}`}
                    className={`shrink-0 inline-flex items-center gap-1.5 font-bold rounded-xl bg-card border border-border text-foreground hover:bg-muted transition-all cursor-pointer ${
                      isElderly ? 'h-14 px-5 text-base' : 'h-11 px-4 text-xs'
                    }`}
                  >
                    <PackagePlus className="w-4 h-4" aria-hidden="true" /> Refill
                  </button>
                )}
              </div>

              {canEdit && openId === med.id && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    inputMode="numeric"
                    autoFocus
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submit(med); }}
                    aria-label={`Units of ${med.drug_name} added`}
                    placeholder={`How many ${unit} did you add?`}
                    className={`flex-1 min-w-0 bg-background border border-input rounded-xl px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring ${
                      isElderly ? 'h-14 text-lg' : 'h-11 text-sm'
                    }`}
                  />
                  <button
                    onClick={() => submit(med)}
                    disabled={busyId === med.id}
                    className={`shrink-0 font-black rounded-xl bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover transition-all cursor-pointer disabled:opacity-50 ${
                      isElderly ? 'h-14 px-6 text-base' : 'h-11 px-4 text-xs'
                    }`}
                  >
                    {busyId === med.id ? 'Saving…' : 'Add'}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Mount the strip**

In `web/src/components/dashboard/dashboard-client-view.tsx`:

Add the import:

```tsx
import RefillStrip from '@/components/dashboard/refill-strip';
import type { LowStockMed } from '@/lib/medications/stock';
```

Change the `lowStockMedicines` prop type in the props interface (currently line 80) to:

```tsx
  lowStockMedicines: LowStockMed[];
  canEditStock: boolean;
```

Add `canEditStock` to the destructured parameter list next to `lowStockMedicines`.

Define the element next to the existing `missedStrip` (around line 503):

```tsx
  // Below the missed strip: a missed dose outranks a refill.
  const refillStrip = (mounted && lowStockMedicines.length > 0) ? (
    <RefillStrip meds={lowStockMedicines} canEdit={canEditStock} />
  ) : null;
```

Render `{refillStrip}` immediately after each existing `{missedStrip}` occurrence (there are two — one in the elderly fork, one in the standard layout).

- [ ] **Step 5: Make the medication-list badge agree**

In `web/src/components/medications/medication-list.tsx`, replace the `isLowStock` local const (lines 282-286) with a call to the shared predicate. The local variable keeps its name so the JSX below is untouched:

```tsx
            const isLowStock = lowStockOf(med).low;
```

and add the import, aliased so it does not collide with the local const:

```tsx
import { isLowStock as lowStockOf } from '@/lib/medications/stock';
```

- [ ] **Step 6: Typecheck and verify in the browser**

Run from `web/`: `./node_modules/.bin/tsc --noEmit`
Expected: no output.

Start the dev server (`.claude/launch.json` → `web`, port 3001) via preview_start, resize to 375×812, open `/dashboard`.
Expected: with a medication at or below its threshold, the orange strip appears near the top naming it and saying why. Tapping Refill opens an amount field; adding stock makes the row disappear after refresh.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/dashboard/refill-strip.tsx "web/src/app/(dashboard)/dashboard/page.tsx" web/src/components/dashboard/dashboard-client-view.tsx web/src/components/medications/medication-list.tsx
git commit -m "feat(dashboard): refill warning strip driven by the shared predicate

The dashboard now selects stock_threshold and computes low stock with
isLowStock instead of a re-typed 3-day heuristic, so the card, the medication
list badge and the bot finally agree. The strip is not dismissible: snoozing
the gate defers the question, not the fact.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The refill gate

**Files:**
- Create: `web/src/components/dashboard/refill-gate.tsx`
- Modify: `web/src/components/dashboard/dashboard-client-view.tsx` (snooze state + mount)

**Interfaces:**
- Consumes: `LowStockMed`, `lowStockReasonText` (Task 2); `addStock` (Task 5); `unitPhrase`.
- Produces: `<RefillGate meds={LowStockMed[]} canEdit={boolean} onSnooze={() => void} />`.

- [ ] **Step 1: Build the gate**

Create `web/src/components/dashboard/refill-gate.tsx`:

```tsx
'use client';

// Full-screen "you need to refill" prompt on app open, the refill counterpart to
// MedDueGate.
//
// Two deliberate differences from MedDueGate:
//
// 1. The dose gate always wins. The parent only mounts this when the dose queue is
//    empty. A dose due now is time-critical and a refill is not, and stacking two
//    full-screen gates is how people learn to tap past both.
// 2. It lists every low medication at once rather than asking one at a time. The dose
//    gate asks individually because each answer is a separate medical fact; a refill
//    is one trip to the pharmacy.
//
// "Remind me tomorrow" is one snooze for all of them, not one per medication —
// per-med snoozes would re-gate the user the moment a second medication went low.

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import { addStock } from '@/lib/medications/add-stock';
import { lowStockReasonText, type LowStockMed } from '@/lib/medications/stock';
import { unitPhrase } from '@/components/medications/medication-form-options';
import { PackagePlus, Clock } from 'lucide-react';

interface RefillGateProps {
  meds: LowStockMed[];
  /** False for a caregiver without can_edit_medications. */
  canEdit: boolean;
  /** Persist "not now" until tomorrow and unmount. */
  onSnooze: () => void;
}

export default function RefillGate({ meds, canEdit, onSnooze }: RefillGateProps) {
  const supabase = createClient();
  const router = useRouter();
  const { isElderly } = useUiMode();
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [doneIds, setDoneIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const submit = async (med: LowStockMed) => {
    setBusyId(med.id);
    setError(null);
    try {
      await addStock({
        supabase,
        medicationId: med.id,
        currentStock: med.stock,
        amount: Number(amounts[med.id]),
      });
      const next = [...doneIds, med.id];
      setDoneIds(next);
      // Everything topped up — close and let the server re-read.
      if (next.length === meds.length) router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update stock.');
    } finally {
      setBusyId(null);
    }
  };

  const remaining = meds.filter((m) => !doneIds.includes(m.id));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Medications needing a refill"
      className="fixed inset-0 z-[110] overflow-y-auto bg-background flex flex-col items-center justify-center px-4 py-10"
    >
      <div className="w-full max-w-md space-y-5">
        <div className="text-center space-y-1">
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-muted-foreground">
            Before you carry on
          </p>
          <h1 className={`font-black tracking-tight text-foreground ${isElderly ? 'text-3xl' : 'text-2xl'}`}>
            {remaining.length === 1 ? 'One medication is running low' : `${remaining.length} medications are running low`}
          </h1>
          <p className={`text-muted-foreground ${isElderly ? 'text-lg' : 'text-sm'}`}>
            {canEdit
              ? 'Bought more? Add it here so the counts stay right.'
              : 'You can see this because you help manage these medications.'}
          </p>
        </div>

        {error && (
          <p className="text-xs font-semibold text-danger-strong bg-danger/10 border border-danger/25 rounded-xl px-3 py-2">
            {error}
          </p>
        )}

        <ul className="space-y-3">
          {remaining.map((med) => {
            const unit = unitPhrase(med.unit_type ?? undefined, med.stock);
            return (
              <li key={med.id} className="bg-card border border-border rounded-2xl p-4 space-y-3 shadow-sm">
                <div>
                  <p className={`font-black text-foreground ${isElderly ? 'text-xl' : 'text-base'}`}>
                    {med.drug_name}
                  </p>
                  <p className={`text-warning-strong font-semibold ${isElderly ? 'text-base' : 'text-xs'}`}>
                    {lowStockReasonText(med, unit)}
                  </p>
                </div>

                {canEdit ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={amounts[med.id] ?? ''}
                      onChange={(e) => setAmounts((p) => ({ ...p, [med.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') submit(med); }}
                      aria-label={`Units of ${med.drug_name} added`}
                      placeholder={`How many ${unit} did you add?`}
                      className={`flex-1 min-w-0 bg-background border border-input rounded-xl px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring ${
                        isElderly ? 'h-16 text-lg' : 'h-12 text-sm'
                      }`}
                    />
                    <button
                      onClick={() => submit(med)}
                      disabled={busyId === med.id}
                      className={`shrink-0 inline-flex items-center gap-1.5 font-black rounded-xl bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover transition-all cursor-pointer disabled:opacity-50 ${
                        isElderly ? 'h-16 px-6 text-lg' : 'h-12 px-5 text-sm'
                      }`}
                    >
                      <PackagePlus className="w-4 h-4" aria-hidden="true" />
                      {busyId === med.id ? 'Saving…' : 'Add'}
                    </button>
                  </div>
                ) : (
                  <p className={`text-muted-foreground ${isElderly ? 'text-base' : 'text-xs'}`}>
                    Ask them to refill — you do not have permission to edit their medications.
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        <button
          onClick={onSnooze}
          className={`w-full inline-flex items-center justify-center gap-2 font-bold rounded-2xl bg-card border border-border text-foreground hover:bg-muted transition-all cursor-pointer ${
            isElderly ? 'h-16 text-lg' : 'h-12 text-sm'
          }`}
        >
          <Clock className="w-4 h-4" aria-hidden="true" /> Remind me tomorrow
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the snooze and mount the gate**

In `web/src/components/dashboard/dashboard-client-view.tsx`, add the import:

```tsx
import RefillGate from '@/components/dashboard/refill-gate';
```

Add the snooze state next to the existing `snoozedUntil` state:

```tsx
  // Refill gate snooze — one timestamp for ALL low medications, not one per med.
  // Mirrors the medGateSnoozes localStorage pattern; per-device by design, same
  // limitation MedDueGate already has.
  const [refillSnoozedUntil, setRefillSnoozedUntil] = useState(0);
  useEffect(() => {
    try {
      setRefillSnoozedUntil(Number(localStorage.getItem('refillGateSnoozedUntil')) || 0);
    } catch { /* ignore */ }
  }, []);

  const handleRefillSnooze = () => {
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0); // next local midnight
    const until = midnight.getTime();
    try { localStorage.setItem('refillGateSnoozedUntil', String(until)); } catch { /* ignore */ }
    setRefillSnoozedUntil(until);
  };
```

Define the gate element immediately after the existing `dueGate` definition (around line 498):

```tsx
  // Refill gate — only once the dose queue is empty. A dose due now is time-critical
  // and outranks a refill; two stacked full-screen gates teach people to tap past both.
  const refillGate = (
    mounted &&
    dueQueue.length === 0 &&
    lowStockMedicines.length > 0 &&
    refillSnoozedUntil <= Date.now()
  ) ? (
    <RefillGate meds={lowStockMedicines} canEdit={canEditStock} onSnooze={handleRefillSnooze} />
  ) : null;
```

Render `{refillGate}` immediately after each existing `{dueGate}` occurrence (two places: the elderly fork around line 712 and the standard layout around line 949).

- [ ] **Step 3: Typecheck**

Run from `web/`: `./node_modules/.bin/tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Verify in the browser**

With a medication at or below its threshold and no dose currently due, open `/dashboard` at 375×812.
Expected:
- The gate covers the screen and names the medication and the reason.
- "Remind me tomorrow" dismisses it, and a reload does **not** bring it back — but the orange strip is still there.
- Clearing `localStorage.refillGateSnoozedUntil` and reloading brings the gate back.
- Adding stock for every low medication closes the gate and clears the strip.
- Every control measures ≥44px:
  ```js
  [...document.querySelectorAll('[role="dialog"] button, [role="dialog"] input')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.height < 44; })
  ```
  Expected: `[]`.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/dashboard/refill-gate.tsx web/src/components/dashboard/dashboard-client-view.tsx
git commit -m "feat(dashboard): refill gate on app open

The refill counterpart to MedDueGate, mounted only when the dose queue is empty
so a time-critical dose always wins. Lists every low medication at once because
a refill is one pharmacy trip, and snoozes them all together until tomorrow.

Shows in caregiver monitor mode, but without can_edit_medications it states
that rather than offering an input that would die on RLS.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Bell type, docs, and the end-to-end pass

**Files:**
- Modify: `web/src/hooks/use-realtime-notifications.ts:11` (type union)
- Modify: `web/src/components/shared/notification-center.tsx` (icon/tone for the new type, if it switches on `type`)
- Modify: `docs/WORK_LEDGER.md`

**Interfaces:**
- Consumes: everything above. Produces nothing new.

- [ ] **Step 1: Accept the new notification type**

In `web/src/hooks/use-realtime-notifications.ts`, line 11, add `| 'LOW_STOCK'` to the end of the `type` union:

```ts
  type: 'TAKEN' | 'SKIPPED' | 'MISSED' | 'ESCALATED' | 'CARE_CIRCLE_ACCESS_REQUEST' | 'CARE_CIRCLE_ACCESS_GRANTED' | 'CARE_CIRCLE_ACCESS_UPDATED' | 'CARE_CIRCLE_ACCESS_REVOKED' | 'CARE_CIRCLE_PRIMARY_CHANGED' | 'UNCONFIRMED' | 'LOW_STOCK';
```

In `web/src/components/shared/notification-center.tsx`, `getTypeIcon` (line 30) switches on the type and falls through to a grey `Bell`. Add a case above `default:` so a refill row reads as the same warning the strip uses:

```tsx
      case 'LOW_STOCK':
        return { icon: <PackagePlus className="w-4 h-4 text-warning-strong" />, bg: 'bg-warning/10' };
```

Add `PackagePlus` to the existing `lucide-react` import in that file.

- [ ] **Step 2: Update the ledger**

In `docs/WORK_LEDGER.md`:

Add to the §4 "Key lib modules" table:

```markdown
| `lib/medications/stock.ts` | **Web mirror of the bot's low-stock predicate** (`isLowStock`: threshold first, `daysOfStockLeft <= 3` backup). Lockstep with `src/reminders.js` is enforced by `test/fixtures/low-stock-cases.json`, which both tests read — same mirror discipline as the moment-timezone pair |
| `lib/medications/add-stock.ts` | The single web path that writes `current_stock`. Raising it clears `low_stock_notified_at` via the `rearm_low_stock_notice()` trigger |
```

Add to the §5 Database "Core" paragraph, after the `medications` entry:
`low_stock_notified_at` (refill-alert suppression; cleared by `rearm_low_stock_notice()` on any stock increase).

Add to §8 open items:

```markdown
- Refill-gate snooze (`localStorage.refillGateSnoozedUntil`) is per-device, like the
  dose gate's `medGateSnoozes` — "remind me tomorrow" on a phone does not silence a tablet.
```

- [ ] **Step 3: Full verification**

Run from the repo root: `npm test`
Expected: PASS, 19 tests.

Run from `web/`: `node --experimental-strip-types src/lib/medications/stock.test.ts`
Expected: `stock.test.ts: 15 shared cases OK`.

Run from `web/`: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 4: End-to-end browser pass**

With the dev server up at 375×812:
1. Set a medication's `current_stock` to exactly its `stock_threshold`. Reload `/dashboard` → gate appears, strip appears, reason reads "you asked to be warned at N".
2. Set stock above threshold but ≤3 days' worth. Reload → gate appears, reason reads "about N days".
3. Set `low_stock_alert_enabled = false`. Reload → no gate, no strip.
4. Pause the medication (`active = false`). Reload → no gate, no strip.
5. Toggle elderly mode and dark mode on the gate and strip; confirm no contrast failure and no control under 44px.
6. Add stock from the gate → gate closes, strip clears.

- [ ] **Step 5: Manual worker check (only after the maintainer applies the migration)**

The 09:00 cron cannot be waited for. Confirm the query the cron runs is valid:

```bash
node -e "
require('dotenv').config({path:'web/.env.local'});
const {createClient}=require('@supabase/supabase-js');
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const {isLowStock}=require('./src/reminders');
s.from('medications').select('*').eq('active',true).eq('low_stock_alert_enabled',true).is('low_stock_notified_at',null)
 .then(({data,error})=>{
   if(error) return console.log('QUERY FAILED (migration not applied yet?):',error.message);
   console.log('eligible rows:',data.length);
   console.log('would alert:',data.filter(m=>isLowStock(m).low).map(m=>m.drug_name));
 });
"
```

Expected: prints the medications that would receive a refill alert on the next 09:00 tick.

- [ ] **Step 6: Commit**

```bash
git add web/src/hooks/use-realtime-notifications.ts web/src/components/shared/notification-center.tsx docs/WORK_LEDGER.md
git commit -m "feat(notifications): LOW_STOCK bell type, and ledger entries

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec section | Task |
|---|---|
| §4 predicate + edge cases | 1, 2 |
| §5 alert pipeline, once-per-crossing | 4 |
| §5 re-arming | 3 |
| §6 `<RefillGate>` | 7 |
| §6 `<RefillStrip>` | 6 |
| §6 one stock-write path | 5 |
| §6 caregiver honesty (`can_edit_medications`) | 6 (server flag), 7 (gate copy) |
| §7 migration | 3 |
| §8 failure modes | 4 (per-channel try/catch), 6+7 (live UI read) |
| §9 testing incl. shared drift fixture | 1, 2, 8 |
| §10 file list | all |

## Ordering and dependencies

Tasks 1 → 2 → 3 must run in order (2 needs 1's fixture; 3 is independent but Task 4 needs it written). Tasks 5, 6, 7 depend on 2. Task 8 is last. Task 4's *runtime* behaviour needs the maintainer to have applied Task 3's migration, but its code is committable before that.
